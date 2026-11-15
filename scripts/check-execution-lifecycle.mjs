// Actual isolated desktop/runner lifecycle; no synthetic keyboard/mouse or
// claims of a model-driven Agent. Close messages are exact-PID/executable scoped.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"
import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const evidence = await assertTestRoot(resolve(process.argv[2]))
assert.equal(JSON.parse(await readFile(join(evidence, ".cloudlink.json"), "utf8")).kind, "p8-evidence")
const closeScript = process.argv[3]
  ? join(await assertTestRoot(resolve(process.argv[3])), "window-tools.ps1")
  : join(project, "scripts/close-isolated-window.ps1")
const closeArgs = process.argv[3] ? ["-Mode", "close"] : []
const root = await mkdtemp(join(evidence, "lifecycle-"))
await assertTestRoot(root)
const home = join(root, "home"), data = join(root, "data"), application = join(root, "application/cloudlink.exe")
for (const path of [home, data, dirname(application), join(home, ".ssh"), join(home, ".claude/skills"), join(home, ".agents/skills"), join(home, "AppData/Roaming"), join(home, "AppData/Local"), join(root, "tmp"), join(root, "ProgramData")]) await mkdir(path, { recursive: true })
await writeFile(join(root, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "p8-execution-lifecycle" }), { flag: "wx" })
await writeFile(join(dirname(application), ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "desktop-test-binary" }), { flag: "wx" })
for (const name of ["cloudlink.exe", "cloudlink-guard.exe"]) await copyFile(join(project, "src-tauri/target/debug", name), join(dirname(application), name), constants.COPYFILE_EXCL)
const known = join(home, ".ssh/known_hosts").replaceAll("\\", "/")
await writeFile(join(home, ".ssh/config"), `Host *\n  UserKnownHostsFile "${known}"\n  GlobalKnownHostsFile none\n  IdentityAgent none\n  IdentityFile none\n`, { flag: "wx" })
await writeFile(join(home, ".ssh/known_hosts"), "", { flag: "wx" })
const system = process.env.SystemRoot || "C:\\Windows"
const env = { SystemRoot: system, WINDIR: system, PATH: process.env.PATH, PATHEXT: process.env.PATHEXT,
  CLOUDLINK_HOME: data, CLOUDLINK_USER_HOME: home, CLOUDLINK_WSL_ROOT: join(root, "wsl"), CLOUDLINK_FAKE_WSL: "",
  HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
  TEMP: join(root, "tmp"), TMP: join(root, "tmp"), ProgramData: join(root, "ProgramData"), PSModuleAnalysisCachePath: "NUL" }
const report = { root, checks: [], appSha256: createHash("sha256").update(await readFile(application)).digest("hex"), inputMethod: "WebView2 named IPC and owned Windows close messages; not SendInput or physical input" }
let desktop, browser, page, target
const waitFor = async (work, label, timeout = 30_000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await work(); if (value) return value; await new Promise((done) => setTimeout(done, 100)) }
  throw new Error(`Timed out: ${label}`)
}
const check = async (name, work) => {
  const started = Date.now()
  try { await work(); report.checks.push({ name, passed: true, ms: Date.now() - started }); console.log(`PASS ${name}`) }
  catch (error) { report.checks.push({ name, passed: false, error: String(error), ms: Date.now() - started }); throw error }
}
const run = (program, args, timeout = 130_000, extra = {}) => {
  const child = spawn(program, args, { cwd: home, env: { ...env, ...extra }, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] })
  const result = new Promise((done, reject) => {
    let stdout = "", stderr = ""
    const timer = setTimeout(() => { child.kill(); reject(new Error("Lifecycle subprocess timed out")) }, timeout)
    child.stdout.on("data", (bytes) => { stdout += bytes; if (stdout.length > 1_048_576) child.kill() })
    child.stderr.on("data", (bytes) => { stderr += bytes; if (stderr.length > 1_048_576) child.kill() })
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }) })
  })
  return { child, result }
}
const runner = (args) => run(join(data, "bin/cloudlink-guard.exe"), args)
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const diagnostics = (result) => result.stderr.split(/\r?\n/u).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line))
const runtime = () => invoke("get_runtime_status")
const requests = () => invoke("list_execution_requests")
async function startDesktop() {
  const socket = createServer()
  await new Promise((done, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", done) })
  const port = socket.address().port
  await new Promise((done) => socket.close(done))
  const started = run(application, [], 600_000, { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` })
  desktop = started.child
  desktop.completion = started.result
  await waitFor(async () => {
    if (desktop.exitCode !== null) throw new Error(`Desktop exited: ${(await desktop.completion).stderr}`)
    return fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.ok).catch(() => false)
  }, "WebView2 endpoint", 60_000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith("http://tauri.localhost")), "main WebView")
  await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeAttached()
  assert.equal((await invoke("get_settings")).dataDir, data)
  await invoke("update_settings", { patch: { autoCheckUpdates: false } })
  return waitFor(async () => { const status = await runtime(); return status.state === "active" && status }, "coordinator active")
}
async function closeOwnedWindow() {
  const metadata = await lstat(closeScript)
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink())
  const result = await run(join(system, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", closeScript, ...closeArgs], 30_000,
    { CLOUDLINK_P8_PID: String(desktop.pid), CLOUDLINK_P8_EXE: application, CLOUDLINK_P8_EVIDENCE_ROOT: root }).result
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout.trim())
}
async function runtimeFile(bytes) {
  await assertTestRoot(data, { inspectContents: true })
  const file = join(data, "runtime.json"), current = JSON.parse(await readFile(file, "utf8"))
  assert.equal(current.managedBy, "cloudlink")
  assert.equal(current.kind, "runtime")
  const temporary = join(data, `.cloudlink-lifecycle-${randomUUID()}`)
  await writeFile(temporary, bytes, { flag: "wx" })
  await rename(temporary, file)
}
try {
  let saved, firstEpoch
  const scratch = `/home/cloudlink/lifecycle-${randomUUID()}`
  await check("isolated desktop onboards its own SSH fixture and publishes an active route", async () => {
    target = await startSshTarget({ root })
    firstEpoch = (await startDesktop()).epoch
    await expect(page.getByRole("heading", { name: "添加第一台服务器", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "添加服务器", exact: true }).click()
    const form = page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/ })
    await form.getByLabel("地址").fill(target.host)
    await form.getByLabel("端口", { exact: true }).fill(String(target.port))
    await form.getByLabel("用户").fill(target.user)
    await form.getByLabel("密码", { exact: true }).fill(target.password)
    await form.getByLabel(/^名称/).fill("Lifecycle fixture")
    await form.getByRole("button", { name: /^连接并启用/ }).click()
    const trust = form.getByTestId("connect-fingerprint")
    await expect(trust.getByTestId("connect-fingerprint-value")).toHaveText(target.hostKeyFingerprint)
    await trust.getByRole("button", { name: "指纹一致，继续", exact: true }).click()
    await form.getByTestId("connect-include").getByRole("button", { name: "加入", exact: true }).click()
    await expect(form).toHaveCount(0, { timeout: 60_000 })
    saved = (await invoke("list_assets"))[0]
    assert.equal(saved.connection.verified.ok, true)
    await invoke("set_mode", { assetId: saved.id, mode: "standard" })
    await target.exec(["mkdir", "--", scratch])
    await target.ssh(`printf '%s' '{"managedBy":"cloudlink","kind":"p8-lifecycle"}' > '${scratch}/.cloudlink.json'; mkdir '${scratch}/never'`)
  })
  const exec = (command) => runner(["exec", "--env", "windows", "--asset", saved.id, "--", command])
  await check("a live desktop with an unreachable coordinator is not an unchecked exit", async () => {
    const old = await readFile(join(data, "runtime.json"))
    const broken = JSON.parse(old)
    const sockets = new Set(), server = createServer((socket) => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); socket.destroy() })
    await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done) })
    broken.endpoint = `127.0.0.1:${server.address().port}`
    try {
      await runtimeFile(JSON.stringify(broken))
      const refused = await exec(`touch '${scratch}/must-not-run'`).result
      assert.equal(refused.code, 125)
      assert.ok(!diagnostics(refused).some((item) => item.checked === false))
      await target.exec(["test", "!", "-e", `${scratch}/must-not-run`])
    } finally { await runtimeFile(old); for (const socket of sockets) socket.destroy(); await new Promise((done) => server.close(done)) }
    const query = await exec("uname -s").result
    assert.equal(query.code, 0, query.stderr)
    assert.ok(diagnostics(query).some((item) => item.checked === true))
  })
  await check("an owned close-to-tray message leaves the process and checks active", async () => {
    await invoke("update_settings", { patch: { closeToTray: true } })
    report.trayClose = await closeOwnedWindow()
    assert.equal(desktop.exitCode, null)
    assert.equal((await runtime()).state, "active")
    const query = await exec("uname -s").result
    assert.equal(query.code, 0, query.stderr)
    assert.ok(diagnostics(query).some((item) => item.checked === true))
  })
  let tickets
  await check("waiting and approved unstarted permits are not granted by full exit", async () => {
    await invoke("update_settings", { patch: { closeToTray: false } })
    const commands = ["old-approved", "old-waiting"].map((name) => `rm -rf -- '${scratch}/never/../never'; touch '${scratch}/${name}'`)
    const pending = commands.map(exec)
    const views = await waitFor(async () => { const rows = (await requests()).filter((request) => request.state === "waiting"); return rows.length === 2 && rows }, "two native pending requests")
    const waiting = await Promise.all(pending.map((item) => item.result))
    waiting.forEach((result) => assert.equal(result.code, 75))
    tickets = waiting.map((result) => diagnostics(result).find((item) => item.state === "waiting").requestId)
    const approved = views.find((view) => view.command === commands[0])
    assert.ok(approved)
    await invoke("respond_execution", { req: { requestId: approved.requestId, expectedRevision: approved.revision, decision: "allow-once" } })
    assert.equal((await requests()).find((request) => request.requestId === approved.requestId).state, "approved")
    report.cancelledRequestIds = views.map((view) => view.requestId) // No ownerTokens are written to evidence.
    await closeOwnedWindow()
    assert.equal((await desktop.completion).code, 0)
    const stopped = await runner(["status"]).result
    assert.equal(JSON.parse(stopped.stdout).state, "stopped")
    for (const ticket of tickets) assert.equal((await runner(["wait", "--env", "windows", ticket]).result).code, 125)
    for (const name of ["old-approved", "old-waiting"]) await target.exec(["test", "!", "-e", `${scratch}/${name}`])
  })
  await check("new calls after confirmed process exit forward unchecked without fabricated audits", async () => {
    const result = await exec(`touch '${scratch}/new-unchecked'`).result
    assert.equal(result.code, 0, result.stderr)
    assert.ok(diagnostics(result).some((item) => item.checked === false && item.state === "succeeded"))
    await target.exec(["test", "-f", `${scratch}/new-unchecked`])
  })
  await check("restart creates a new epoch and old tickets never resume execution", async () => {
    browser = null
    const restarted = await startDesktop()
    assert.equal(restarted.state, "active")
    assert.notEqual(restarted.epoch, firstEpoch)
    assert.deepEqual(await requests(), [])
    for (const ticket of tickets) assert.equal((await runner(["wait", "--env", "windows", ticket]).result).code, 125)
    for (const name of ["old-approved", "old-waiting"]) await target.exec(["test", "!", "-e", `${scratch}/${name}`])
    const operations = await invoke("list_operations", { q: { assetId: saved.id, limit: 100 } })
    assert.ok(!operations.some((operation) => operation.command.includes("new-unchecked")))
    assert.equal((await exec("uname -s").result).code, 0)
    report.epochs = [firstEpoch, restarted.epoch]
  })
  report.passed = true
} finally {
  if (desktop?.exitCode === null) { desktop.kill(); await desktop.completion.catch(() => {}) }
  await browser?.close().catch(() => {})
  await target?.dispose()
  await writeFile(join(root, "result.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" })
  console.log(`Lifecycle evidence: ${root}`)
}
