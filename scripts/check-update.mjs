// P8-only real updater acceptance. Requires explicit --run --root <fresh built fixture>.
// No real-profile snapshots, registry, shortcuts, default WSL HOME or recursive cleanup.
// The signed NSIS fixture has no system integration; this is not an uninstall/release gate.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { lstat, mkdir, readdir } from "node:fs/promises"
import { createServer } from "node:http"
import { createServer as portProbe } from "node:net"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium, expect } from "@playwright/test"

import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"
import { VERSIONS, installerName } from "./update-test-config.mjs"
import { builtArtifacts, execute, fileBytes, hash, isolatedEnvironment, isolatedTrayCopy, loadFixture, newFile, nsisPayloadHash, owner, powershell } from "../e2e-update/isolation.mjs"

const args = process.argv.slice(2)
assert.ok(args.length === 3 && args[0] === "--run" && args[1] === "--root", "Use --run --root <fresh built P8 fixture>; installation requires separate authorization")
if (process.platform !== "win32") throw new Error("The updater acceptance requires Windows")
const fixture = await loadFixture(args[2])
const artifacts = await builtArtifacts(fixture)
const [OLD, NEW] = VERSIONS
const env = isolatedEnvironment(fixture)
const trayCopy = await isolatedTrayCopy()
const installedExe = join(fixture.installDir, "cloudlink.exe")
const installedGuard = join(fixture.installDir, "cloudlink-guard.exe")
const copiedGuard = join(fixture.dataHome, "bin/cloudlink-guard.exe")
const evidence = join(fixture.root, "evidence/acceptance")
await assertTestRoot(evidence)
await mkdir(evidence) // A run is never resumed over old evidence or an earlier installation.
const initialOwner = await owner(fixture, fixture.installDir, "update-test-install")
assert.equal(initialOwner.version, null, "Prepare a new fixture; do not overwrite an earlier test installation")
assert.deepEqual(initialOwner.files, {})
assert.equal(await lstat(join(fixture.dataHome, "data.db")).then(() => true, (error) => { if (error.code !== "ENOENT") throw error; return false }), false, "Prepare a fresh fixture")

const report = { root: fixture.root, installationIdentity: fixture.identifier, sourceSnapshotHash: artifacts.sourceSnapshotHash, buildProfile: artifacts.buildProfile, systemNotificationBodyOmitted: true, checks: [], screenshots: [], screenshotsReviewedWithAnalyzeImage: false }
const runners = new Set()
const apps = []
const pageErrors = []
let browser, page, target, saved, running

async function waitFor(work, description, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await work()
    if (value) return value
    await delay(100)
  }
  throw new Error(`Timed out: ${description}`)
}
async function check(name, work) {
  const start = Date.now()
  try { await work(); report.checks.push({ name, passed: true, ms: Date.now() - start }); console.log(`PASS ${name}`) }
  catch (error) { report.checks.push({ name, passed: false, error: String(error), ms: Date.now() - start }); throw error }
}
async function shot(name) {
  const path = join(evidence, `${name}.png`)
  const bytes = await page.screenshot({ animations: "disabled" })
  await newFile(fixture, path, bytes)
  report.screenshots.push(path)
}
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const status = () => invoke("get_update_status")
const runtime = () => invoke("get_runtime_status")
const requests = () => invoke("list_execution_requests")
const operations = () => invoke("list_operations", { q: { assetId: saved.id, limit: 200 } })

// Read only a known PID, then compare image path and creation time before control.
// No enumeration of production installations or unrelated cloudlink processes.
function processInfo(pid) {
  const script = String.raw`
$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'
try { $process=[Diagnostics.Process]::GetProcessById([int]$env:CLOUDLINK_UPDATE_PID) }
catch [ArgumentException] { exit 0 }
try { '{0}|{1}|{2}' -f $process.Id,$process.StartTime.ToUniversalTime().Ticks,$process.MainModule.FileName } finally { $process.Dispose() }`
  const text = execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { fixture, env: { ...env, CLOUDLINK_UPDATE_PID: String(pid) }, capture: true, cwd: fixture.root })
  if (!text) return null
  const [id, createdTicks, path] = text.split("|")
  assert.ok(path.replaceAll("\\", "/").toLowerCase() === installedExe.replaceAll("\\", "/").toLowerCase(), "The PID is not this fixture's executable")
  return { pid: Number(id), createdTicks }
}
function rememberApp(pid) {
  const info = processInfo(pid)
  assert.ok(info, "Fixture process already exited")
  apps.push(info)
  return info
}
function launch() {
  const child = spawn(installedExe, [], { cwd: fixture.root, env, shell: false, windowsHide: true, stdio: "ignore" })
  const started = new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
  return started.then(() => rememberApp(child.pid))
}
const debugEndpoint = () => `http://127.0.0.1:${fixture.debugPort}`
async function connect() {
  await waitFor(() => fetch(`${debugEndpoint()}/json/version`).then((r) => r.ok, () => false), "fixture CDP endpoint", 120_000)
  browser = await chromium.connectOverCDP(debugEndpoint())
  page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith("http://tauri.localhost")), "fixture page")
  // A per-run compiled HTML title identifies this target before any IPC can read data.
  await expect(page).toHaveTitle(fixture.productName)
  page.on("pageerror", (error) => pageErrors.push(error.message))
  assert.equal((await invoke("get_settings")).dataDir, fixture.dataHome)
  await waitFor(async () => (await runtime()).state === "active", "execution coordinator is active")
  await invoke("set_tray_copy", { copy: trayCopy })
}
async function disconnect() {
  await browser?.close().catch(() => {})
  browser = undefined
  page = undefined
}
function stopKnownApp(info) {
  const current = processInfo(info.pid)
  if (!current || current.createdTicks !== info.createdTicks) return
  const script = String.raw`
$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'
try { $process=[Diagnostics.Process]::GetProcessById([int]$env:CLOUDLINK_UPDATE_PID) } catch [ArgumentException] { exit 0 }
try {
  if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $env:CLOUDLINK_UPDATE_CREATED) { throw 'PID was reused' }
  if ([IO.Path]::GetFullPath($process.MainModule.FileName) -ne [IO.Path]::GetFullPath($env:CLOUDLINK_UPDATE_EXE)) { throw 'Image changed' }
  $process.Kill(); $null=$process.WaitForExit(15000)
} finally { $process.Dispose() }`
  execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { fixture, env: { ...env, CLOUDLINK_UPDATE_PID: String(info.pid), CLOUDLINK_UPDATE_CREATED: info.createdTicks, CLOUDLINK_UPDATE_EXE: installedExe }, capture: true, cwd: fixture.root })
}

const installerUrl = `/${encodeURIComponent(installerName(fixture, NEW))}`
const server = { manifest: null, package: null, requests: [] }
const http = createServer((req, res) => {
  server.requests.push({ method: req.method, url: req.url })
  if (req.method === "GET" && req.url === "/latest.json" && server.manifest) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(server.manifest)); return }
  if (req.method === "GET" && req.url === installerUrl && server.package) { res.writeHead(200, { "content-type": "application/octet-stream", "content-length": server.package.length }); res.end(server.package); return }
  res.writeHead(404); res.end()
})
async function manifest(signaturePath) {
  const signature = (await fileBytes(fixture, signaturePath, 64 * 1024)).toString("utf8").trim()
  assert.ok(signature)
  return { version: NEW, pub_date: new Date().toISOString(), notes: "Isolated P8 updater acceptance", platforms: { "windows-x86_64": { signature, url: `http://127.0.0.1:${fixture.updatePort}${installerUrl}` } } }
}
async function recheck(packageBytes, manifestValue) {
  server.package = packageBytes
  server.manifest = manifestValue
  await invoke("update_settings", { patch: { autoCheckUpdates: false } })
  await invoke("update_settings", { patch: { autoCheckUpdates: true } })
  await waitFor(async () => (await status()).state === "ready", "the real updater downloaded and verified its package", 120_000)
}
function diagnostic(stderr) {
  return stderr.split(/\r?\n/u).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }).filter((value) => value.source === "cloudlink").at(-1)
}
function runner(args, timeout = 130_000) {
  const child = spawn(copiedGuard, args, { cwd: fixture.userHome, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] })
  runners.add(child)
  let stdout = "", stderr = "", failure
  const timer = setTimeout(() => { failure = new Error("Fixture runner exceeded its local harness timeout; remote result is unknown"); child.kill() }, timeout)
  for (const [stream, name] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
    stream.setEncoding("utf8")
    stream.on("data", (chunk) => {
      if (name === "stdout") stdout += chunk; else stderr += chunk
      if (stdout.length + stderr.length > 64 * 1024) { failure = new Error("Fixture runner output exceeded the test limit"); child.kill() }
    })
  }
  const completed = new Promise((resolve, reject) => {
    child.once("error", (error) => { clearTimeout(timer); runners.delete(child); reject(error) })
    child.once("close", (code) => { clearTimeout(timer); runners.delete(child); if (failure) reject(failure); else resolve({ code, stdout, diagnostic: diagnostic(stderr) }) })
  })
  // The long-running promise is awaited after installation; attach a rejection
  // observer now without masking the eventual result or leaving an unhandled rejection.
  completed.catch(() => {})
  // Do not persist raw stderr: waiting receipts contain a one-request owner token.
  return { child, completed }
}
// Custom commands and explicit shell wrappers require approval in both modes.
// Keep the wrapper to exercise the opaque-command update handoff.
const taskCommand = (name) => `sh -c 'cloudlink-p8-task ${name}'`
const task = (name, timeout = 130_000) => runner(["exec", "--env", "windows", "--asset", saved.id, "--timeout", "600", "--", taskCommand(name)], timeout)
const getRequest = async (id) => (await requests()).find((item) => item.requestId === id)
async function allow(id) {
  await page.keyboard.press("Control+3")
  const card = page.locator(`[id="execution-${id}"]`)
  await expect(card.getByRole("button", { name: "允许一次", exact: true })).toBeVisible()
  await card.getByRole("button", { name: "允许一次", exact: true }).click()
}
async function unstartedPair(label) {
  // Both real exec calls reach the 90-second waiting boundary before one is
  // approved. No runner is left to claim that second permit until a later wait.
  const first = task(`waiting-${label}`), second = task(`approved-${label}`)
  const outcomes = await Promise.all([first.completed, second.completed])
  const ids = [], tickets = []
  for (const outcome of outcomes) {
    assert.equal(outcome.code, 75, `The opaque SSH sample must reach approval: ${JSON.stringify({ state: outcome.diagnostic?.state, reasonId: outcome.diagnostic?.reasonId })}`)
    assert.equal(outcome.diagnostic?.state, "waiting")
    const ticket = outcome.diagnostic.requestId
    assert.ok(typeof ticket === "string" && /^req_[A-Za-z0-9_-]+\.[0-9a-f]{64}$/u.test(ticket), "Invalid private waiting receipt")
    const id = ticket.slice(0, ticket.lastIndexOf("."))
    assert.equal((await getRequest(id)).state, "waiting")
    ids.push(id); tickets.push(ticket)
  }
  await allow(ids[1])
  await waitFor(async () => (await getRequest(ids[1]))?.state === "approved", "allowed once, not yet claimed")
  await expect(page.locator(`[id="execution-${ids[1]}"]`)).toContainText("已允许，等 Agent 继续")
  report[`${label}UnstartedRequests`] = ids // Bare IDs only; never the owner tokens.
  return { ids, tickets }
}
async function cancelled(pair, epoch) {
  const log = await operations()
  for (const id of pair.ids) {
    const item = log.find((entry) => entry.requestId === id)
    assert.equal(item?.executionState, "cancelled", `Unstarted ${id} was not cancelled`)
    assert.equal(item.epoch, epoch)
    assert.equal(item.exitCode, undefined)
  }
  assert.equal((await target.ssh(`test ! -e /tmp/cloudlink-p8-${fixture.runId}/unstarted`)).code, 0, "Neither unstarted command may execute")
}
async function userFiles() {
  const result = {}
  for (const name of [".ssh/config", ".ssh/cloudlink.conf", ".ssh/known_hosts", ".claude/settings.json", ".claude/skills/existing/SKILL.md", ".agents/skills/existing/SKILL.md", ".claude/skills/cloudlink-servers/SKILL.md", ".agents/skills/cloudlink-servers/SKILL.md"]) result[name] = hash(await fileBytes(fixture, join(fixture.userHome, name)))
  return result
}

try {
  await check("fresh fixture, local source and loopback ports only", async () => {
    await assertTestRoot(fixture.installDir, { inspectContents: true })
    await assertTestRoot(fixture.tmp, { inspectContents: true })
    const probe = portProbe()
    await new Promise((done, reject) => { probe.once("error", reject); probe.listen(fixture.debugPort, "127.0.0.1", done) })
    await new Promise((done) => probe.close(done))
    await new Promise((done, reject) => { http.once("error", reject); http.listen(fixture.updatePort, "127.0.0.1", done) })
    // Its key must be inside CloudLink's declared isolated roots, not an evidence sibling.
    target = await startSshTarget({ root: fixture.dataHome }) // Docker HOME/config remain temporary.
    const remote = `/tmp/cloudlink-p8-${fixture.runId}`
    const script = [
      "#!/bin/sh", "set -eu", `root='${remote}'`,
      `test "$(cat "$root/.cloudlink.json")" = '{"managedBy":"cloudlink","kind":"update-test-ssh","runId":"${fixture.runId}"}'`,
      'case "$1" in',
      '  waiting-*|approved-*) printf "%s\\n" "$1" >> "$root/unstarted" ;;',
      '  running) printf "started\\n" >> "$root/started"; while [ ! -f "$root/release" ]; do sleep 1; done; printf "finished\\n" >> "$root/finished"; printf "cloudlink-p8-running-finished\\n" ;;',
      '  *) exit 64 ;;', 'esac', "",
    ].join("\n")
    const quoted = (value) => `'${value.replaceAll("'", "'\\''")}'`
    await target.exec(["sh", "-c", `mkdir ${quoted(remote)} && printf '%s' ${quoted(JSON.stringify({ managedBy: "cloudlink", kind: "update-test-ssh", runId: fixture.runId }))} > ${quoted(`${remote}/.cloudlink.json`)} && printf '%s' ${quoted(script)} > /usr/local/bin/cloudlink-p8-task && chmod 755 /usr/local/bin/cloudlink-p8-task && chown -R cloudlink:cloudlink ${quoted(remote)}`], { user: "root" })
  })

  await check(`actual isolated NSIS ${OLD} install and protected startup`, async () => {
    const installer = join(fixture.root, "artifacts", OLD, installerName(fixture, OLD))
    execute(installer, ["/S", "/NS", `/D=${fixture.installDir}`], { fixture, env, cwd: fixture.root, capture: true })
    const marker = await owner(fixture, fixture.installDir, "update-test-install")
    assert.equal(marker.version, OLD)
    assert.equal(hash(await fileBytes(fixture, installedExe)), nsisPayloadHash(await fileBytes(fixture, join(fixture.root, "artifacts", OLD, "cloudlink.exe"))))
    assert.equal(hash(await fileBytes(fixture, installedGuard)), artifacts.files[`${OLD}/cloudlink-guard.exe`])
    const good = await manifest(join(fixture.root, "artifacts", NEW, `${installerName(fixture, NEW)}.sig`))
    server.manifest = { ...good, version: OLD }
    const info = await launch()
    report.oldPid = info.pid
    await connect()
    assert.equal((await status()).currentVersion, OLD)
    await shot("01-isolated-old")
  })

  await check("real key-auth SSH, managed copies and hook; no vault or CLI login", async () => {
    await page.getByRole("button", { name: "添加服务器", exact: true }).click()
    const form = page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/u })
    await form.getByLabel("地址").fill(target.host)
    await form.getByLabel("端口", { exact: true }).fill(String(target.port))
    await form.getByLabel("用户").fill(target.user)
    await form.getByLabel(/^名称/u).fill("P8 更新靶机")
    await form.getByRole("button", { name: "私钥文件", exact: true }).click()
    await form.getByRole("textbox", { name: /Windows.*私钥路径/u }).fill(target.identityFile)
    await form.getByRole("button", { name: /^连接并启用/u }).click()
    const trust = form.getByTestId("connect-fingerprint")
    await expect(trust).toBeVisible({ timeout: 30_000 })
    await expect(trust).toContainText(target.hostKeyFingerprint)
    await trust.getByRole("button", { name: "指纹一致，继续", exact: true }).click()
    await expect(form.getByTestId("connect-include")).toBeVisible({ timeout: 30_000 })
    await form.getByTestId("connect-include").getByRole("button", { name: "加入", exact: true }).click()
    await expect(form).toHaveCount(0, { timeout: 60_000 })
    await waitFor(async () => (await invoke("list_assets"))[0]?.probe?.status === "ok", "first SSH probe finishes", 120_000)
    saved = (await invoke("list_assets"))[0]
    assert.equal(saved.production, true)
    assert.equal(saved.connection.auth.method, "key")
    assert.equal(saved.connection.verified.ok, true)
    await invoke("set_mode", { assetId: saved.id, mode: "auto-ops" })
    const deliveries = await invoke("check_deliveries")
    assert.equal(deliveries.filter((item) => item.status === "ok").length, 2)
    assert.equal((await invoke("install_guard", { envId: "windows" })).state, "active")
    const routes = JSON.parse((await fileBytes(fixture, join(fixture.dataHome, "routes/manifest.json"))).toString("utf8"))
    const route = routes.resources.find((item) => item.assetId === saved.id && item.envId === "windows")
    assert.equal(route?.enabled, true, `Isolated SSH route unavailable: ${route?.reasonId}`)
    report.assetId = saved.id
    await shot("02-real-ssh-and-copies")
  })

  await check("real updater install failure restores checks and cancels waiting/approved", async () => {
    const before = await runtime()
    const pair = await unstartedPair("failure")
    await recheck(await fileBytes(fixture, join(fixture.root, "artifacts/invalid-installer.bin")), await manifest(join(fixture.root, "artifacts/invalid-installer.bin.sig")))
    await assertTestRoot(fixture.tmp, { inspectContents: true })
    await invoke("install_update") // Signature is genuine; non-EXE format fails only in real install/extract.
    await waitFor(async () => (await status()).error?.id === "update-install-failed", "genuine installer-format failure")
    assert.equal((await status()).state, "ready")
    assert.equal((await runtime()).state, "active")
    assert.equal((await runtime()).epoch, before.epoch)
    assert.equal(processInfo(report.oldPid).pid, report.oldPid)
    await cancelled(pair, before.epoch)
    const denied = await runner(["exec", "--env", "windows", "--asset", saved.id, "--", "cat /etc/shadow"]).completed
    assert.equal(denied.code, 125, "Checks must still reject credentials after install failure")
    assert.equal(denied.diagnostic?.checked, true)
    assert.equal(denied.diagnostic?.state, "denied")
    for (const ticket of pair.tickets) {
      const result = await runner(["wait", "--env", "windows", ticket]).completed
      assert.equal(result.code, 125)
      assert.equal(result.stdout, "")
    }
    report.installFailureEpoch = before.epoch
    await shot("03-install-failure-restored")
  })

  let pair, oldEpoch, beforeFiles, beforeAssets
  await check("waiting/approved cancellation and an actual older runner span the update", async () => {
    pair = await unstartedPair("update")
    oldEpoch = (await runtime()).epoch
    beforeFiles = await userFiles()
    beforeAssets = await invoke("list_assets")
    running = task("running", 660_000)
    const request = await waitFor(async () => (await requests()).find((item) => item.command === taskCommand("running") && item.state === "waiting"), "running fixture asks through the original card")
    await allow(request.requestId)
    await waitFor(async () => {
      const current = await getRequest(request.requestId)
      if (current?.state === "running") return true
      if (["failed", "unknown", "succeeded", "cancelled", "expired", "denied"].includes(current?.state)) {
        const outcome = await running.completed
        report.runningFailure = { code: outcome.code, state: outcome.diagnostic?.state, reasonId: outcome.diagnostic?.reasonId }
        throw new Error(`Older runner ended before the update: ${JSON.stringify(report.runningFailure)}`)
      }
      return false
    }, "older runner starts exactly once")
    assert.equal((await target.ssh(`cat /tmp/cloudlink-p8-${fixture.runId}/started`)).stdout.trim(), "started")
    report.runningRequestId = request.requestId
    report.oldRunnerPid = running.child.pid
    report.oldGuardHash = hash(await fileBytes(fixture, copiedGuard))
    const good = await manifest(join(fixture.root, "artifacts", NEW, `${installerName(fixture, NEW)}.sig`))
    await recheck(await fileBytes(fixture, join(fixture.root, "artifacts", NEW, installerName(fixture, NEW))), good)
    await assertTestRoot(fixture.installDir, { inspectContents: true })
    await assertTestRoot(fixture.tmp, { inspectContents: true })
    await page.getByRole("banner").getByRole("button", { name: `有新版本 ${NEW}，查看并更新`, exact: true }).click()
    await page.getByRole("dialog", { name: `新版本 ${NEW}`, exact: true }).getByRole("button", { name: "重启以更新", exact: true }).click()
    await disconnect()
    const receiptPath = join(fixture.root, "receipts", `reopened-${NEW}.json`)
    const receipt = await waitFor(async () => {
      const exists = await lstat(receiptPath).then(() => true, (error) => { if (error.code !== "ENOENT") throw error; return false })
      return exists ? JSON.parse((await fileBytes(fixture, receiptPath, 64 * 1024)).toString("utf8")) : false
    }, "actual NSIS installs and directly reopens the new version", 180_000)
    assert.equal(receipt.managedBy, "cloudlink")
    assert.equal(receipt.runId, fixture.runId)
    assert.equal(receipt.kind, "update-test-reopen-receipt")
    assert.equal(receipt.version, NEW)
    const newProcess = rememberApp(receipt.pid)
    assert.notEqual(newProcess.pid, report.oldPid)
    report.newPid = newProcess.pid
    await connect()
    assert.equal((await status()).currentVersion, NEW)
    assert.notEqual((await runtime()).epoch, oldEpoch)
    const marker = await owner(fixture, fixture.installDir, "update-test-install")
    assert.equal(marker.version, NEW)
    assert.equal(hash(await fileBytes(fixture, installedExe)), nsisPayloadHash(await fileBytes(fixture, join(fixture.root, "artifacts", NEW, "cloudlink.exe"))))
    assert.equal(hash(await fileBytes(fixture, copiedGuard)), artifacts.files[`${NEW}/cloudlink-guard.exe`])
    assert.notEqual(hash(await fileBytes(fixture, copiedGuard)), report.oldGuardHash)
    assert.equal(runners.has(running.child), true, "The older already-started runner must survive")
    report.retainedOldGuardFiles = (await readdir(join(fixture.dataHome, "bin"))).filter((name) => name.startsWith(".cloudlink-guard-old-bin_") && name.endsWith(".exe"))
    const guardOwner = JSON.parse((await fileBytes(fixture, join(fixture.dataHome, "bin/.cloudlink.json"), 64 * 1024)).toString("utf8"))
    assert.equal(guardOwner.managedBy, "cloudlink")
    assert.equal(guardOwner.kind, "guard-bin")
    const retained = report.retainedOldGuardFiles.find((name) => guardOwner.retiredFiles?.[name] === report.oldGuardHash)
    assert.ok(retained, "The occupied old executable must have an ownership/hash receipt")
    assert.equal(hash(await fileBytes(fixture, join(fixture.dataHome, "bin", retained))), report.oldGuardHash)
    await cancelled(pair, oldEpoch)
    await shot("04-real-update-reopened")
  })

  await check("late terminal from the real old runner is ingested once, not replayed", async () => {
    await target.ssh(`set -C; printf release > /tmp/cloudlink-p8-${fixture.runId}/release`)
    const outcome = await running.completed
    assert.equal(outcome.code, 0)
    assert.equal(outcome.stdout.trim(), "cloudlink-p8-running-finished")
    assert.equal(outcome.diagnostic?.checked, true)
    assert.equal(outcome.diagnostic?.state, "succeeded")
    const terminal = await waitFor(async () => (await operations()).find((entry) => entry.requestId === report.runningRequestId && entry.executionState === "succeeded"), "older runner's actual terminal audit is imported")
    assert.equal(terminal.epoch, oldEpoch)
    assert.equal(terminal.exitCode, 0)
    assert.equal(terminal.source, "runner")
    assert.equal(terminal.checked, true)
    assert.equal((await operations()).filter((entry) => entry.requestId === report.runningRequestId).length, 1)
    assert.equal((await target.ssh(`cat /tmp/cloudlink-p8-${fixture.runId}/started; cat /tmp/cloudlink-p8-${fixture.runId}/finished`)).stdout.trim(), "started\nfinished")
    for (const ticket of pair.tickets) {
      const result = await runner(["wait", "--env", "windows", ticket]).completed
      assert.equal(result.code, 125, "Cancelled old permits cannot execute in the new epoch")
      assert.equal(result.stdout, "")
    }
    assert.equal((await requests()).some((item) => pair.ids.includes(item.requestId)), false)
    await cancelled(pair, oldEpoch)
    assert.deepEqual(await invoke("list_assets"), beforeAssets)
    assert.deepEqual(await userFiles(), beforeFiles)
    assert.deepEqual(pageErrors, [])
    assert.ok(server.requests.every((item) => item.url === "/latest.json" || item.url === installerUrl))
    report.httpRequests = server.requests
    await shot("05-late-terminal-no-replay")
  })
} catch (error) {
  report.error = String(error)
  process.exitCode = 1
  if (page) await shot("failure").catch((failure) => { report.screenshotError = String(failure) })
} finally {
  await disconnect()
  // These are local test-owned handles, not a taskkill by executable name. A
  // harness failure cannot claim it rolled back a remote command's side effects.
  for (const child of runners) child.kill()
  for (const info of apps) {
    try { stopKnownApp(info) } catch (error) { report.cleanupError = String(error); process.exitCode = 1 }
  }
  http.closeAllConnections()
  if (http.listening) await new Promise((done) => http.close(done))
  if (target) await target.dispose().catch((error) => { report.targetCleanupError = String(error); process.exitCode = 1 })
  report.retainedFixture = true // No uninstaller, unlink of cache Junctions, or directory deletion.
  await newFile(fixture, join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`P8 updater evidence: ${evidence}`)
  console.log("All captured screenshots still require analyze_image; this script does not claim visual approval.")
  if (report.error) console.error(report.error)
}
