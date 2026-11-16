// Real WSL entry -> active desktop coordinator -> original approval -> SSH -> audit.
// WSL environment discovery/Skills delivery are NOT claimed: only the native SSH
// route is injected into this owned fixture, avoiding any read of the real WSL HOME.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { performance } from "node:perf_hooks"
import { chromium, expect } from "@playwright/test"
import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const evidence = await assertTestRoot(resolve(process.argv[2]))
assert.equal(JSON.parse(await readFile(join(evidence, ".cloudlink.json"), "utf8")).kind, "p8-evidence")
const root = await mkdtemp(join(evidence, "wsl-active-"))
await assertTestRoot(root)
const home = join(root, "home"), data = join(root, "data"), application = join(root, "application/cloudlink.exe")
const wslRoot = join(root, "wsl"), distro = "Ubuntu-24.04", envId = `wsl:${distro}`, token = randomUUID()
for (const path of [home, data, dirname(application), join(home, ".ssh"), join(home, ".claude/skills"), join(home, ".agents/skills"), join(home, "AppData/Roaming"), join(home, "AppData/Local"), join(root, "tmp"), join(root, "ProgramData"), wslRoot]) await mkdir(path, { recursive: true })
await writeFile(join(root, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "p8-execution-lifecycle", purpose: "wsl-active", token }), { flag: "wx" })
await writeFile(join(dirname(application), ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "desktop-test-binary" }), { flag: "wx" })
for (const name of ["cloudlink.exe", "cloudlink-guard.exe"]) await copyFile(join(project, "src-tauri/target/debug", name), join(dirname(application), name), constants.COPYFILE_EXCL)
await writeFile(join(home, ".ssh/config"), `Host *\n  UserKnownHostsFile "${join(home, ".ssh/known_hosts").replaceAll("\\", "/")}"\n  GlobalKnownHostsFile none\n  IdentityAgent none\n  IdentityFile none\n`, { flag: "wx" })
await writeFile(join(home, ".ssh/known_hosts"), "", { flag: "wx" })
const system = process.env.SystemRoot || "C:\\Windows", wsl = join(system, "System32/wsl.exe")
const env = { SystemRoot: system, WINDIR: system, PATH: process.env.PATH, PATHEXT: process.env.PATHEXT,
  CLOUDLINK_HOME: data, CLOUDLINK_USER_HOME: home, CLOUDLINK_WSL_ROOT: wslRoot, CLOUDLINK_FAKE_WSL: distro,
  HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
  TEMP: join(root, "tmp"), TMP: join(root, "tmp"), ProgramData: join(root, "ProgramData"), PSModuleAnalysisCachePath: "NUL" }
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const report = { root, checks: [], appSha256: hash(await readFile(application)), boundary: "Real WSL SSH and live approvals/audits; WSL environment descriptor and private route injected, not native discovery or Skills delivery; no model-driven Agent claim" }
let target, desktop, browser, page, nativeHome, saved, configPath, configHash, entryPath, working
const run = (program, args, { input = "", timeout = 130_000, extra = {} } = {}) => {
  const started = performance.now()
  const child = spawn(program, args, { cwd: home, env: { ...env, ...extra }, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] })
  const result = new Promise((done, reject) => {
    let stdout = "", stderr = "", overflow = false
    const timer = setTimeout(() => { child.kill(); reject(new Error("WSL active subprocess timed out")) }, timeout)
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", (bytes) => { stdout += bytes; if (stdout.length > 1_048_576) { overflow = true; child.kill() } })
    child.stderr.on("data", (bytes) => { stderr += bytes; if (stderr.length > 1_048_576) { overflow = true; child.kill() } })
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr, overflow, ms: performance.now() - started }) })
    child.stdin.on("error", () => {}); child.stdin.end(input)
  })
  return { child, result }
}
const linux = async (args) => {
  const result = await run(wsl, ["-d", distro, "-e", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", `HOME=${nativeHome || "/tmp"}`, ...args], { timeout: 30_000 }).result
  assert.equal(result.code, 0, result.stderr)
  return result
}
const nativePath = async (path) => (await linux(["wslpath", "-a", "-u", path])).stdout.trim()
const waitFor = async (work, label, timeout = 30_000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await work(); if (value) return value; await new Promise((done) => setTimeout(done, 100)) }
  throw new Error(`Timed out: ${label}`)
}
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const requests = () => invoke("list_execution_requests")
const diagnostics = (result) => result.stderr.split(/\r?\n/u).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line))
const entry = (args, options) => run(wsl, ["-d", distro, "--cd", working, "-e", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", `HOME=${nativeHome}`, `XDG_CONFIG_HOME=${nativeHome}/.config`, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", entryPath, ...args], options)
const exec = (command, options) => entry(["exec", "--env", envId, "--asset", saved.id, "--", command], options)
const check = async (name, work) => {
  const started = performance.now()
  try { await work(); report.checks.push({ name, passed: true, ms: performance.now() - started }); console.log(`PASS ${name}`) }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); throw error }
}
async function replaceOwned(path, kind, value) {
  await assertTestRoot(data, { inspectContents: true })
  const before = JSON.parse(await readFile(path, "utf8"))
  assert.equal(before.managedBy, "cloudlink"); assert.equal(before.kind, kind)
  const temporary = join(dirname(path), `.cloudlink-wsl-fixture-${randomUUID()}`)
  await writeFile(temporary, JSON.stringify(value), { flag: "wx" })
  await rename(temporary, path)
}
async function bindNativeRoute() {
  const directory = join(data, "routes"), markerPath = join(directory, ".cloudlink.json"), manifestPath = join(directory, "manifest.json")
  const marker = JSON.parse(await readFile(markerPath, "utf8")), manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  assert.equal(marker.managedBy, "cloudlink"); assert.equal(marker.kind, "execution-routes"); assert.equal(marker.manifestOwned, true)
  const original = manifest.resources.find((route) => route.assetId === saved.id && route.envId === "windows")
  assert.equal(original?.enabled, true)
  const route = { ...original, envId, distro, interop: true, home: nativeHome, sshPath: "/usr/bin/ssh", configPath: configPath.replaceAll("\\", "/"), configNative: await nativePath(configPath), configHash,
    policy: { ...original.policy, envId, envIds: ["windows", envId] } }
  manifest.resources = [...manifest.resources.filter((route) => route.assetId !== saved.id || route.envId !== envId), route]
  manifest.revision += 1
  marker.files[configPath.split(/[\\/]/u).at(-1)] = configHash
  await replaceOwned(markerPath, "execution-routes", marker)
  await replaceOwned(manifestPath, "execution-routes", manifest)
}
async function closeOwned() {
  const result = await run(join(system, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(project, "scripts/close-isolated-window.ps1")], { timeout: 30_000, extra: { CLOUDLINK_P8_PID: String(desktop.pid), CLOUDLINK_P8_EXE: application, CLOUDLINK_P8_EVIDENCE_ROOT: root } }).result
  assert.equal(result.code, 0, result.stderr)
}
try {
  await check("isolated desktop and SSH fixture are active before any native WSL operation", async () => {
    target = await startSshTarget({ root })
    nativeHome = (await linux(["mktemp", "-d", "/tmp/cloudlink-p8-active-XXXXXXXX"])).stdout.trim()
    assert.match(nativeHome, /^\/tmp\/cloudlink-p8-active-[A-Za-z0-9]{8}$/u)
    const marker = join(root, "wsl-home-marker.json")
    await writeFile(marker, JSON.stringify({ managedBy: "cloudlink", kind: "p8-wsl-active-home", token }), { flag: "wx" })
    await linux(["cp", "--no-clobber", "--", await nativePath(marker), `${nativeHome}/.cloudlink.json`])
    await linux(["cp", "--no-clobber", "--", await nativePath(target.identityFile), `${nativeHome}/identity`])
    await linux(["chmod", "600", "--", `${nativeHome}/identity`])
    const socket = createServer()
    await new Promise((done, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", done) })
    const port = socket.address().port
    await new Promise((done) => socket.close(done))
    const launch = run(application, [], { timeout: 600_000, extra: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } })
    desktop = launch.child; desktop.completion = launch.result
    await waitFor(async () => {
      if (desktop.exitCode !== null) throw new Error((await desktop.completion).stderr)
      return fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.ok).catch(() => false)
    }, "WebView2", 60_000)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith("http://tauri.localhost")), "main WebView")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeAttached()
    assert.equal((await invoke("get_settings")).dataDir, data)
    await invoke("update_settings", { patch: { autoCheckUpdates: false } })
    await page.getByRole("button", { name: "添加服务器", exact: true }).click()
    const form = page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/ })
    await form.getByLabel("地址").fill(target.host)
    await form.getByLabel("端口", { exact: true }).fill(String(target.port))
    await form.getByLabel("用户").fill(target.user)
    await form.getByLabel("密码", { exact: true }).fill(target.password)
    await form.getByLabel(/^名称/).fill("WSL active fixture")
    await form.getByRole("button", { name: /^连接并启用/ }).click()
    const trust = form.getByTestId("connect-fingerprint")
    await expect(trust.getByTestId("connect-fingerprint-value")).toHaveText(target.hostKeyFingerprint)
    await trust.getByRole("button", { name: "指纹一致，继续", exact: true }).click()
    await form.getByTestId("connect-include").getByRole("button", { name: "加入", exact: true }).click()
    await expect(form).toHaveCount(0, { timeout: 60_000 })
    saved = (await invoke("list_assets"))[0]
    assert.equal(saved.connection.verified.ok, true)
    assert.equal((await invoke("get_runtime_status")).state, "active")
    entryPath = await nativePath(join(data, "bin/cloudlink-guard.exe")); working = await nativePath(home)
    const config = [`Host ${saved.connection.sshAlias}`, "  HostName 127.0.0.1", `  Port ${target.port}`, "  User cloudlink", `  IdentityFile ${nativeHome}/identity`, `  UserKnownHostsFile "${await nativePath(join(target.directory, "known_hosts"))}"`, `  HostKeyAlias ${saved.connection.sshAlias}`, "  IdentityAgent none", "  IdentitiesOnly yes", "  GlobalKnownHostsFile none", "  BatchMode yes", "  StrictHostKeyChecking yes", "  PermitLocalCommand no", "  ClearAllForwardings yes", "  RequestTTY no", ""].join("\n")
    // The SSH fixture known_hosts entry was pinned to its own alias, not the desktop alias.
    const known = join(root, "wsl-known-hosts")
    const hostKey = (await readFile(join(target.directory, "host_key.pub"), "utf8")).trim()
    await writeFile(known, `${saved.connection.sshAlias} ${hostKey}\n`, { flag: "wx" })
    const nativeConfig = config.replace(await nativePath(join(target.directory, "known_hosts")), await nativePath(known))
    configHash = hash(Buffer.from(nativeConfig)); configPath = join(data, "routes", `ssh-wsl-${configHash}.conf`)
    await writeFile(configPath, nativeConfig, { flag: "wx" })
    await bindNativeRoute()
  })
  await check("real WSL queries pass and writes wait for confirmation before SSH", async () => {
    const query = await exec("uname -s | head -n 1").result
    assert.equal(query.code, 0, query.stderr); assert.equal(query.stdout.trim(), "Linux")
    assert.ok(diagnostics(query).some((row) => row.checked === true && row.state === "succeeded"))
    const remote = `/home/cloudlink/p8-wsl-denied-${token}`
    const command = `touch '${remote}'`
    const pending = exec(command)
    const request = await waitFor(async () => (await requests()).find((row) => row.command === command && row.state === "waiting"), "WSL write confirmation")
    assert.equal(request.approvalRequired, true)
    await target.exec(["test", "!", "-e", remote])
    await invoke("respond_execution", { req: { requestId: request.requestId, expectedRevision: request.revision, decision: "deny" } })
    const denied = await pending.result
    assert.equal(denied.code, 125); await target.exec(["test", "!", "-e", remote])
    assert.ok(diagnostics(denied).some((row) => row.checked === true && row.state === "rejected"))
  })
  const scratch = `/home/cloudlink/p8-wsl-active-${token}`
  await target.exec(["mkdir", "--", scratch])
  await target.ssh(`printf '%s' '{"managedBy":"cloudlink","kind":"p8-wsl-active"}' > '${scratch}/.cloudlink.json'; mkdir '${scratch}/never'`)
  await check("WSL waits beyond 90 seconds then original GUI approval starts one execution and imports its real audit", async () => {
    await invoke("set_mode", { assetId: saved.id, mode: "auto-ops" }); await bindNativeRoute()
    const command = `rm -rf -- '${scratch}/never/../never'; printf 'x\\n' >> '${scratch}/counter'`
    const pending = exec(command)
    const request = await waitFor(async () => (await requests()).find((row) => row.command === command && row.state === "waiting"), "original WSL approval")
    const waiting = await pending.result
    assert.equal(waiting.code, 75, waiting.stderr)
    const ticket = diagnostics(waiting).find((row) => row.state === "waiting")?.requestId
    assert.ok(ticket); assert.ok(waiting.ms >= 89_000)
    await page.getByRole("button", { name: /^动态/ }).click()
    await expect(page.getByRole("button", { name: "允许一次", exact: true })).toBeVisible()
    await page.screenshot({ path: join(root, "01-wsl-active-waiting.png"), animations: "disabled" })
    await page.getByRole("button", { name: "允许一次", exact: true }).click()
    assert.equal((await requests()).find((row) => row.requestId === request.requestId).state, "approved")
    assert.equal((await entry(["wait", "--env", "windows", ticket]).result).code, 125)
    const executed = await entry(["wait", "--env", envId, ticket]).result
    assert.equal(executed.code, 0, executed.stderr)
    assert.ok(diagnostics(executed).some((row) => row.checked === true && row.state === "succeeded"))
    await entry(["wait", "--env", envId, ticket]).result
    assert.equal((await target.exec(["cat", "--", `${scratch}/counter`])).stdout, "x\n")
    const operation = await waitFor(async () => (await invoke("list_operations", { q: { assetId: saved.id, limit: 100 } })).find((row) => row.requestId === request.requestId), "WSL audit import")
    assert.equal(operation.envId, envId); assert.equal(operation.checked, true); assert.equal(operation.exitCode, 0)
    report.approvedRequestId = request.requestId
    await waitFor(async () => (await requests()).find((row) => row.requestId === request.requestId)?.state === "succeeded", "WSL completion")
    await page.screenshot({ path: join(root, "02-wsl-active-completed.png"), animations: "disabled" })
  })
  await check("WSL unstarted approval is cancelled by narrowing rather than executing a new input", async () => {
    const command = `rm -rf -- '${scratch}/never/../never'; touch '${scratch}/must-not-run'`
    const pending = exec(command)
    const request = await waitFor(async () => (await requests()).find((row) => row.command === command && row.state === "waiting"), "WSL narrowing approval")
    await invoke("set_mode", { assetId: saved.id, mode: "confirm-changes" })
    const cancelled = await pending.result
    assert.equal(cancelled.code, 125, cancelled.stderr)
    assert.equal((await requests()).find((row) => row.requestId === request.requestId).state, "cancelled")
    await target.exec(["test", "!", "-e", `${scratch}/must-not-run`]); await bindNativeRoute()
  })
  await check("Windows and WSL managed hook processes are measured against their actual current runtime", async () => {
    const program = join(data, "bin/cloudlink-guard.exe")
    const input = JSON.stringify({ session_id: "p8-isolated-performance", cwd: home, tool_name: "Bash", tool_input: { command: `ssh ${saved.connection.sshAlias} 'uname -s'` } })
    const samples = []
    for (let index = 0; index < 100; index++) {
      const result = await run(program, ["--env", "windows"], { input, timeout: 10_000 }).result
      assert.equal(result.code, 0, result.stderr)
      assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny")
      samples.push(result.ms)
    }
    const ordered = [...samples].sort((a, b) => a - b)
    report.guardPerformance = { windows: { samples: samples.length, measurements: samples, p95Ms: ordered[Math.ceil(samples.length * 0.95) - 1], budgetMs: 50 } }
    // WSL source route is fixture-injected while its policy registry remains Windows-only;
    // measure the active, canonical runner hook (must not be double-checked or audited).
    const nativeInput = JSON.stringify({ session_id: "p8-isolated-performance", cwd: working, tool_name: "Bash", tool_input: { command: `'${entryPath}' exec --env '${envId}' --asset '${saved.id}' -- 'uname -s'` } })
    const wslSamples = []
    for (let index = 0; index < 100; index++) {
      const result = await entry(["--env", envId], { input: nativeInput, timeout: 10_000 }).result
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, "")
      wslSamples.push(result.ms)
    }
    const sorted = [...wslSamples].sort((a, b) => a - b)
    report.guardPerformance.wsl = { samples: wslSamples.length, measurements: wslSamples, p95Ms: sorted[Math.ceil(wslSamples.length * 0.95) - 1], budgetMs: 300, scope: "Managed-runner hook bypass including WSL startup; not all SSH/CLI rule paths" }
    report.guardPerformance.windows.passed = report.guardPerformance.windows.p95Ms <= 50
    report.guardPerformance.wsl.passed = report.guardPerformance.wsl.p95Ms <= 300
    console.log(`MEASURE guard p95: Windows=${report.guardPerformance.windows.p95Ms.toFixed(2)}ms; WSL=${report.guardPerformance.wsl.p95Ms.toFixed(2)}ms`)
  })
  await check("full exit does not preserve an injected route absent from the authoritative registry", async () => {
    // update_settings republishes the actual registry, so this intentionally injected
    // native route is withdrawn. Stopped forwarding is verified by check-wsl-entry.
    await invoke("update_settings", { patch: { closeToTray: false } }); await closeOwned()
    assert.equal((await desktop.completion).code, 0)
    const status = await entry(["status"]).result
    assert.equal(status.code, 0, status.stderr); assert.equal(JSON.parse(status.stdout).state, "stopped")
    const withdrawn = await exec("uname -s").result
    assert.equal(withdrawn.code, 125, withdrawn.stderr)
    assert.ok(diagnostics(withdrawn).some((row) => row.reasonId === "execution-resource-unavailable"))
    report.stoppedForwardingBoundary = "Injected route withdrawn by authoritative registry publication; use check-wsl-entry for confirmed-stopped native forwarding"
  })
  report.passed = true
} finally {
  if (desktop?.exitCode === null) { desktop.kill(); await desktop.completion.catch(() => {}) }
  await browser?.close().catch(() => {})
  if (nativeHome) {
    const cleanup = String.raw`import json,os,stat,sys
root,token=sys.argv[1:]
assert root.startswith('/tmp/cloudlink-p8-active-') and os.path.realpath(root)==root and not stat.S_ISLNK(os.lstat(root).st_mode)
with open(root+'/.cloudlink.json') as f: marker=json.load(f)
assert marker=={'managedBy':'cloudlink','kind':'p8-wsl-active-home','token':token}
assert set(os.listdir(root))=={'.cloudlink.json','identity'}
for name in ('.cloudlink.json','identity'):
 p=root+'/'+name
 assert stat.S_ISREG(os.lstat(p).st_mode) and not stat.S_ISLNK(os.lstat(p).st_mode)
for name in ('identity','.cloudlink.json'): os.unlink(root+'/'+name)
os.rmdir(root)
`
    await linux(["python3", "-I", "-c", cleanup, nativeHome, token]); report.wslHomeRemoved = true
  }
  await target?.dispose()
  await writeFile(join(root, "result.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" })
  console.log(`WSL active evidence: ${root}`)
}
