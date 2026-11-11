// Exercise the built WebView2 app and real named IPC. No mockIPC, real user profile, or OS vault.
// Build with `pnpm build:desktop-test`, then run `pnpm e2e:desktop` on Windows with WSL Docker.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { createServer as httpServer } from "node:http"
import { createConnection, createServer as tcpServer } from "node:net"
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"

import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspace = dirname(project)
const appPath = resolve(project, process.argv[2] ?? "src-tauri/target/debug/cloudlink.exe")
if (process.platform !== "win32") throw new Error("The desktop integration check requires Windows WebView2")
const output = join(workspace, "test-results", "desktop")
await assertTestRoot(output)
await mkdir(output, { recursive: true })
await assertTestRoot(output)
const runRoot = await mkdtemp(join(output, "run-"))
await assertTestRoot(runRoot)
const dataRoot = join(runRoot, "应用 数据")
const userRoot = join(runRoot, "home 测试")
const launchPath = join(runRoot, "程序 测试", "cloudlink.exe")
const report = { app: appPath, root: runRoot, checks: [], coverage: "WebView2, native IPC, isolated Windows SSH, managed copies and packaged guard" }
let desktop
let browser
let page
let target
const consoleErrors = []

function childEnvironment() {
  const env = {}
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "SystemDrive", "PATH", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]) {
    const entry = Object.entries(process.env).find(([name]) => name.toLowerCase() === key.toLowerCase())
    if (entry) env[entry[0]] = entry[1]
  }
  return {
    ...env,
    CLOUDLINK_HOME: dataRoot,
    CLOUDLINK_USER_HOME: userRoot,
    CLOUDLINK_WSL_ROOT: join(runRoot, "wsl"),
    CLOUDLINK_FAKE_WSL: "",
    HOME: userRoot,
    USERPROFILE: userRoot,
    APPDATA: join(userRoot, "AppData", "Roaming"),
    LOCALAPPDATA: join(userRoot, "AppData", "Local"),
    ProgramData: join(runRoot, "ProgramData"),
    TEMP: join(runRoot, "tmp"),
    TMP: join(runRoot, "tmp"),
  }
}

async function port() {
  const server = tcpServer()
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done) })
  const value = server.address().port
  await new Promise((done) => server.close(done))
  return value
}

async function silentSsh(work) {
  const sockets = new Set()
  let accepted = false
  const server = tcpServer((socket) => {
    accepted = true
    sockets.add(socket)
    socket.on("error", () => {})
    socket.once("close", () => sockets.delete(socket))
    socket.resume()
  })
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done) })
  try {
    await work({
      port: server.address().port,
      connected: () => waitFor(() => accepted, "SSH process reaches the silent fixture", 10_000),
      closed: () => waitFor(() => sockets.size === 0, "SSH process releases its socket", 5_000),
    })
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((done) => server.close(done))
  }
}

const connectionRefused = (port) => new Promise((done) => {
  const socket = createConnection({ host: "127.0.0.1", port })
  socket.once("connect", () => { socket.destroy(); done(false) })
  socket.once("error", (error) => done(error.code === "ECONNREFUSED"))
  socket.setTimeout(1_000, () => { socket.destroy(); done(false) })
})

async function statIfPresent(path) {
  try { return await lstat(path) }
  catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

async function waitFor(work, description, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await work()
    if (result) return result
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Timed out: ${description}`)
}

async function check(name, work) {
  const started = Date.now()
  try {
    await work()
    report.checks.push({ name, passed: true, ms: Date.now() - started })
    console.log(`PASS ${name}`)
  } catch (error) {
    report.checks.push({ name, passed: false, error: String(error), ms: Date.now() - started })
    throw error
  }
}

// This test driver crosses the real WebView boundary; application code still uses src/lib/ipc.ts.
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const rejected = async (command, args, id) => {
  const result = await page.evaluate(async ({ command, args }) => {
    try { await window.__TAURI_INTERNALS__.invoke(command, args); return null }
    catch (error) { return error }
  }, { command, args })
  assert.equal(result?.id, id, `${command} must reject with ${id}`)
}
const asset = async (id) => (await invoke("list_assets")).find((item) => item.id === id)
const event = (name, predicate) => waitFor(async () => {
  const events = await page.evaluate(() => window.__cloudlinkDesktopEvents)
  return events.filter((entry) => entry.event === name).map((entry) => entry.payload).findLast(predicate)
}, name)

function inputOf(saved) {
  const { source, sshAlias, host, port, user, auth, proxyJump, definedIn } = saved.connection
  const editable = { ...saved }
  for (const key of ["agent", "createdAt", "updatedAt", "probe"]) delete editable[key]
  return {
    ...editable,
    connection: source === "imported" ? { source, sshAlias } : {
      source, sshAlias, host, port, user, proxyJump, definedIn,
      auth: { method: auth.method, identityFile: auth.identityFile },
    },
  }
}

async function failedConnection(overrides, expected, password) {
  const { testId } = await invoke("test_connection", { req: {
    envId: "windows",
    connection: { ...inputOf(saved).connection, ...overrides },
    ...(password === undefined ? {} : { password }),
  } })
  const result = await event("connection://tested", (entry) => entry.testId === testId)
  assert.equal(result.status, "failed")
  assert.equal(result.error?.id, expected)
}

async function run(executable, args, input, extraEnv = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { cwd: runRoot, env: { ...childEnvironment(), ...extraEnv }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => { child.kill(); reject(new Error("Test subprocess timed out")) }, 30_000)
    child.stdout.on("data", (bytes) => { stdout += bytes })
    child.stderr.on("data", (bytes) => { stderr += bytes })
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }) })
    child.stdin.on("error", () => {})
    child.stdin.end(input)
  })
}

async function guard(command, expected) {
  const result = await run(join(dataRoot, "bin", "cloudlink-guard.exe"), ["--env", "windows"], JSON.stringify({
    tool_name: "Bash", session_id: "desktop-integration", cwd: runRoot, tool_input: { command },
  }))
  assert.equal(result.code, 0)
  if (expected === "denied") assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny")
  else assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
}

let saved
let originalConfig
const originalSettings = '{\n  "theme": "dark",\n  "permissions": { "deny": ["Read(./private)"] }\n}\n'
const preserved = "Existing user skill fixture — keep these bytes.\n"

function insideUserRoot(path) {
  const suffix = relative(userRoot, resolve(path))
  assert.ok(suffix && !suffix.startsWith("..") && !isAbsolute(suffix), "Test writes must stay in the isolated user root")
}

async function ownedCopy(path, expectedTarget) {
  insideUserRoot(path)
  assert.ok(expectedTarget, "Managed copy must match a detected target")
  assert.equal(resolve(path), resolve(expectedTarget.path, "cloudlink-servers"))
  await assertTestRoot(path, { inspectContents: true })
  for (const name of [".cloudlink.json", "SKILL.md"]) {
    const info = await lstat(join(path, name))
    assert.ok(info.isFile() && !info.isSymbolicLink(), "Managed copy metadata and content must be regular files")
  }
  const marker = JSON.parse(await readFile(join(path, ".cloudlink.json"), "utf8"))
  assert.equal(marker.managedBy, "cloudlink")
  assert.equal(marker.envId, expectedTarget.envId)
  assert.equal(marker.agentKey, expectedTarget.agentKey)
}

try {
  await check("isolated test roots and packaged application", async () => {
    assert.ok((await lstat(appPath)).isFile())
    report.appSha256 = createHash("sha256").update(await readFile(appPath)).digest("hex")
    await mkdir(dirname(launchPath))
    await writeFile(join(dirname(launchPath), ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "desktop-test-binary" }), { flag: "wx" })
    await copyFile(appPath, launchPath, constants.COPYFILE_EXCL)
    await copyFile(join(dirname(appPath), "cloudlink-guard.exe"), join(dirname(launchPath), "cloudlink-guard.exe"), constants.COPYFILE_EXCL)
    for (const directory of [dataRoot, join(userRoot, ".ssh"), join(userRoot, ".claude", "skills", "existing"), join(userRoot, ".agents", "skills", "existing"), join(userRoot, ".codex"), join(runRoot, "tmp"), join(runRoot, "ProgramData"), join(userRoot, "AppData", "Roaming"), join(userRoot, "AppData", "Local")]) {
      await mkdir(directory, { recursive: true })
    }
    await writeFile(join(runRoot, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "desktop-test" }))
    await writeFile(join(userRoot, ".claude", "settings.json"), originalSettings)
    for (const folder of [".claude", ".agents"]) await writeFile(join(userRoot, folder, "skills", "existing", "SKILL.md"), preserved)
    // OpenSSH's OS profile lookup is independent of HOME on Windows. Pin every fallback explicitly.
    const knownHosts = join(userRoot, ".ssh", "known_hosts").replaceAll("\\", "/")
    originalConfig = `# Existing SSH configuration fixture\nHost *\n  UserKnownHostsFile "${knownHosts}"\n  GlobalKnownHostsFile none\n  IdentityAgent none\n  IdentityFile none\n`
    await writeFile(join(userRoot, ".ssh", "config"), originalConfig)
    await writeFile(join(userRoot, ".ssh", "known_hosts"), "")
    target = await startSshTarget({ root: runRoot })
  })

  await check("built WebView2 starts with native IPC and isolated plugin storage", async () => {
    const debugPort = await port()
    desktop = spawn(launchPath, [], { cwd: runRoot, windowsHide: true, env: {
      ...childEnvironment(),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
    }, stdio: ["ignore", "pipe", "pipe"] })
    desktop.stdout.on("data", () => {})
    let errors = ""
    desktop.stderr.on("data", (bytes) => { errors += bytes })
    desktop.once("error", (error) => { errors += String(error) })
    await waitFor(async () => {
      if (desktop.exitCode !== null) throw new Error(`Desktop exited (${desktop.exitCode}): ${errors}`)
      return fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.ok).catch(() => false)
    }, "WebView2 debugging endpoint", 60_000)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
    page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith("http://tauri.localhost")), "application page")
    page.on("pageerror", (error) => consoleErrors.push(error.message))
    await expect(page.getByRole("heading", { name: "添加第一台服务器", exact: true })).toBeVisible({ timeout: 30_000 })
    const settings = await invoke("get_settings")
    assert.equal(settings.dataDir, dataRoot)
    assert.equal(settings.logDir, join(dataRoot, "logs"))
    assert.deepEqual(await invoke("list_assets"), [])
    assert.deepEqual((await invoke("detect_environments")).map((item) => item.id), ["windows"])
    assert.equal((await invoke("list_targets")).filter((item) => item.enabled).length, 2)
    assert.ok((await readdir(join(dataRoot, "desktop"))).length > 0)
    await page.evaluate(async () => {
      window.__cloudlinkDesktopEvents = []
      window.__cloudlinkDesktopFailures = []
      const nativeInvoke = window.__TAURI_INTERNALS__.invoke
      window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
        try { return await nativeInvoke(command, args, options) }
        catch (error) {
          window.__cloudlinkDesktopFailures.push({ command, error })
          throw error
        }
      }
      for (const name of ["connection://tested", "probe://finished", "compile://finished", "deliveries://changed", "deliveries://backed-up", "guard://changed", "notes://new", "operations://new"]) {
        const callback = window.__TAURI_INTERNALS__.transformCallback((entry) => window.__cloudlinkDesktopEvents.push(entry))
        await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: name, target: { kind: "Any" }, handler: callback })
      }
    })
    await page.screenshot({ path: join(runRoot, "01-native-empty.png") })
  })

  await check("production CSP blocks external scripts before a request is sent", async () => {
    let requests = 0
    const server = httpServer((_request, response) => { requests++; response.end("window.remoteExecuted = true") })
    await new Promise((done) => server.listen(0, "127.0.0.1", done))
    try {
      const src = `http://127.0.0.1:${server.address().port}/forbidden.js`
      const result = await page.evaluate(async (src) => {
        const response = await fetch(location.href)
        const csp = response.headers.get("content-security-policy") ?? document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content
        const blocked = await new Promise((done) => {
          const script = document.createElement("script")
          script.src = src
          script.onerror = () => { script.remove(); done(true) }
          script.onload = () => { script.remove(); done(false) }
          document.head.append(script)
        })
        return { csp, blocked }
      }, src)
      assert.ok(result.csp?.includes("script-src"))
      assert.ok(result.blocked)
      assert.equal(requests, 0)
    } finally { await new Promise((done) => server.close(done)) }
  })

  await check("password onboarding trusts fingerprint, converts key, probes and distributes", async () => {
    await page.getByRole("button", { name: "添加服务器", exact: true }).click()
    // The same region changes its title during connection; wait for its removal,
    // not for the old form title to disappear before key conversion has finished.
    const form = page.getByRole("region", { name: /^(添加 SSH 服务器|连接 )/ })
    await form.getByLabel("地址").fill(target.host)
    await form.getByLabel("端口", { exact: true }).fill(String(target.port))
    await form.getByLabel("用户").fill(target.user)
    await expect(form.getByRole("button", { name: "密码", exact: true })).toHaveAttribute("aria-pressed", "true")
    await form.getByLabel("密码", { exact: true }).fill(target.password)
    await form.getByLabel(/^名称/).fill("Desktop SSH")
    await expect(form.getByRole("switch", { name: "生产环境", exact: true })).toBeChecked()
    await expect(form.getByRole("textbox", { name: "别名", exact: true })).toHaveValue("desktop-ssh")
    await form.getByRole("button", { name: /^连接并启用/ }).click()
    const trust = form.getByTestId("connect-fingerprint")
    await expect(trust).toBeVisible({ timeout: 30_000 })
    await expect(trust.getByTestId("connect-fingerprint-value")).toHaveText(target.hostKeyFingerprint)
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await trust.getByRole("button", { name: "指纹一致，继续", exact: true }).click()
    const include = form.getByTestId("connect-include")
    await expect(include).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await include.getByRole("button", { name: "加入", exact: true }).click()
    await expect(form).toHaveCount(0, { timeout: 60_000 })
    saved = (await invoke("list_assets"))[0]
    assert.equal(saved.connection.sshAlias, "desktop-ssh")
    assert.equal(saved.connection.auth.method, "key")
    assert.equal(saved.connection.auth.passwordSaved, false)
    assert.equal(saved.connection.verified.ok, true)
    assert.equal(saved.production, true)
    assert.equal(saved.agent.mode, "read-only")
    assert.deepEqual([...saved.agent.agents].sort(), ["claude-code", "universal"])
    const probed = await event("probe://finished", (entry) => entry.assetId === saved.id)
    assert.equal(probed.status, "ok", JSON.stringify(probed.error))
    saved = await asset(saved.id)
    assert.match(saved.facts.os, /Alpine/)
    const compilation = await invoke("get_compile_status")
    assert.ok(compilation.every((item) => !item.blocked), JSON.stringify(compilation))
    const deliveries = await invoke("list_deliveries")
    assert.equal(deliveries.length, 2)
    assert.ok(deliveries.every((item) => item.status === "ok"), JSON.stringify(deliveries))
    for (const folder of [".claude", ".agents"]) {
      const content = await readFile(join(userRoot, folder, "skills", "cloudlink-servers", "SKILL.md"), "utf8")
      assert.ok(content.includes("desktop-ssh"))
      assert.ok(!content.includes(target.password))
      assert.ok(!content.includes(target.host))
    }
    assert.equal(await readFile(join(userRoot, ".ssh", "config.cloudlink-bak"), "utf8"), originalConfig)
    const includePath = join(userRoot, ".ssh", "cloudlink.conf").replaceAll("\\", "/")
    assert.ok((await readFile(join(userRoot, ".ssh", "config"), "utf8")).startsWith(`Include "${includePath}"`))
    await page.screenshot({ path: join(runRoot, "02-native-server.png") })
  })

  await check("Windows OpenSSH and Git OpenSSH use the generated key", async () => {
    const nativeConfig = join(userRoot, ".ssh", "config")
    const nativeInclude = join(userRoot, ".ssh", "cloudlink.conf").replaceAll("\\", "/")
    // MSYS treats D:/... in Include as relative. Use its absolute path spelling for
    // this isolated entry point, while both clients read the same managed Host/key.
    // Production uses the shared ~/.ssh/cloudlink.conf Include, not this override.
    const msysInclude = nativeInclude.replace(/^([A-Za-z]):\//, (_match, drive) => `/${drive.toLowerCase()}/`)
    const gitConfig = join(runRoot, "git-ssh.config")
    const nativeText = await readFile(nativeConfig, "utf8")
    assert.ok(nativeText.startsWith(`Include "${nativeInclude}"`))
    await assertTestRoot(gitConfig)
    await writeFile(gitConfig, nativeText.replace(`Include "${nativeInclude}"`, `Include "${msysInclude}"`), { flag: "wx" })
    report.sshClients = []
    for (const [executable, config] of [
      ["C:/Windows/System32/OpenSSH/ssh.exe", nativeConfig],
      ["D:/Git/usr/bin/ssh.exe", gitConfig],
    ]) {
      const result = await run(executable, ["-F", config, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "--", "desktop-ssh", "true"])
      assert.equal(result.code, 0, `${executable}: ${result.stderr}`)
      report.sshClients.push({ executable, config })
    }
  })

  await check("native SSH classifies rejected credentials and refused ports without changing saved verification", async () => {
    const before = (await asset(saved.id)).connection
    await failedConnection({ auth: { method: "password", identityFile: {} } }, "password-rejected", "incorrect-fixture-password")
    const wrongKey = join(runRoot, "unauthorized_ed25519")
    const generated = await run("C:/Windows/System32/OpenSSH/ssh-keygen.exe", ["-q", "-t", "ed25519", "-N", "", "-C", "cloudlink-negative-fixture", "-f", wrongKey])
    assert.equal(generated.code, 0, generated.stderr)
    await failedConnection({ auth: { method: "key", identityFile: { windows: wrongKey } } }, "auth-failed")
    await failedConnection({ auth: { method: "key", identityFile: { windows: join(runRoot, "missing-key") } } }, "key-not-found")
    await failedConnection({ port: await port() }, "connection-refused")
    assert.deepEqual((await asset(saved.id)).connection, before)
  })

  await check("native SSH handshake timeout and cancellation release their sockets", async () => {
    await silentSsh(async (fixture) => {
      await failedConnection({ port: fixture.port }, "timeout")
      await fixture.closed()
    })
    await silentSsh(async (fixture) => {
      const { testId } = await invoke("test_connection", { req: {
        envId: "windows", connection: { ...inputOf(saved).connection, port: fixture.port },
      } })
      await fixture.connected()
      await invoke("cancel_connection_test", { testId })
      const result = await event("connection://tested", (entry) => entry.testId === testId)
      assert.equal(result.status, "cancelled")
      assert.equal(result.error, undefined)
      assert.equal(result.hostKey, undefined)
      await fixture.closed()
    })
    assert.equal((await asset(saved.id)).connection.verified.ok, true)
  })

  await check("real IPC validation rejects malformed requests and unverified authorization", async () => {
    await rejected("set_mode", { assetId: "missing", mode: "read-only" }, "not-found")
    await rejected("update_settings", { patch: { dataDir: join(runRoot, "elsewhere") } }, "settings-invalid")
    const input = inputOf(saved)
    delete input.id
    input.name = "Unverified fixture"
    input.connection.sshAlias = "unverified-fixture"
    const result = await invoke("save_asset", { input })
    await rejected("set_distribute", { assetId: result.asset.id, agentKey: "claude-code", on: true }, "cannot-distribute")
    await invoke("delete_asset", { id: result.asset.id, opts: { removeGeneratedKey: false } })
  })

  await check("packaged guard installs, enforces modes and imports operation records", async () => {
    const status = await invoke("install_guard", { envId: "windows" })
    assert.equal(status.state, "active")
    assert.equal(await readFile(join(userRoot, ".claude", "settings.json.cloudlink-bak"), "utf8"), originalSettings)
    await guard("ssh desktop-ssh 'uptime'", "allowed")
    await guard("ssh desktop-ssh 'docker restart api'", "denied")
    await guard("ssh desktop-ssh 'cat /opt/app/.env'", "denied")
    await invoke("set_mode", { assetId: saved.id, mode: "standard" })
    await guard("ssh desktop-ssh 'docker restart api'", "allowed")
    await guard("ssh desktop-ssh 'docker compose down -v'", "denied")
    saved = await asset(saved.id)
    const input = inputOf(saved)
    input.services.push({ kind: "docker", name: "nginx", ports: [], critical: true, source: "manual", missing: false })
    await invoke("save_asset", { input })
    await guard("ssh desktop-ssh 'docker stop nginx'", "denied")
    await invoke("set_mode", { assetId: saved.id, mode: "read-only" })
    await guard("ssh desktop-ssh 'docker restart api'", "denied")
    const operations = await invoke("list_operations", { q: { assetId: saved.id, limit: 50 } })
    assert.equal(operations.length, 7)
    assert.equal(operations.filter((item) => item.decision === "denied").length, 5)
  })

  await check("notes require review and clean edited text before entering the skill", async () => {
    const inbox = join(dataRoot, "inbox", "desktop-ssh.md")
    const day = new Date().toISOString().slice(0, 10)
    await writeFile(inbox, `- ${day}: Deploy from /opt/apps/api using compose.\n- ${day}: password=fixture-password-only\n`)
    const notes = await invoke("list_notes", { assetId: saved.id })
    assert.equal(notes.length, 2)
    const sensitive = notes.find((item) => item.flags.includes("secret"))
    const clean = notes.find((item) => !item.flags.includes("secret"))
    assert.ok(sensitive)
    await rejected("merge_notes", { items: [{ id: sensitive.id }] }, "note-has-secret")
    await invoke("merge_notes", { items: [{ id: clean.id }, { id: sensitive.id, text: "Keep deployment credentials in the local vault." }] })
    assert.equal((await invoke("list_notes", { assetId: saved.id })).length, 0)
    saved = await asset(saved.id)
    assert.ok(saved.notes.includes("Deploy from /opt/apps/api"))
    assert.ok(!saved.notes.includes("fixture-password-only"))
  })

  await check("blocked compilation cannot restore revoked copies; automatic repair backs up edits and undo pauses synchronization", async () => {
    saved = await asset(saved.id)
    const input = inputOf(saved)
    input.summary = "password=fixture-compile-block"
    assert.ok((await invoke("save_asset", { input })).statuses.some((item) => item.blocked))
    await invoke("set_distribute", { assetId: saved.id, agentKey: "claude-code", on: false })
    assert.equal(await statIfPresent(join(userRoot, ".claude", "skills", "cloudlink-servers")), null)
    saved = await asset(saved.id)
    const fixed = inputOf(saved)
    fixed.summary = "Local SSH integration fixture"
    await invoke("save_asset", { input: fixed })
    await invoke("set_distribute", { assetId: saved.id, agentKey: "claude-code", on: true })
    let deliveries = await invoke("list_deliveries")
    const targets = await invoke("list_targets")
    const claude = deliveries.find((item) => item.path.includes(".claude"))
    const universal = deliveries.find((item) => item.path.includes(".agents"))
    await ownedCopy(claude.path, targets.find((item) => item.id === claude.targetId))
    const original = await readFile(join(claude.path, "SKILL.md"), "utf8")
    await writeFile(join(claude.path, "SKILL.md"), `${original}\nExternal fixture edit\n`)
    await ownedCopy(universal.path, targets.find((item) => item.id === universal.targetId))
    const moved = join(dirname(universal.path), "moved-test-copy")
    insideUserRoot(moved)
    await assertTestRoot(moved)
    const existing = await lstat(moved).catch((error) => { if (error.code !== "ENOENT") throw error })
    assert.equal(existing, undefined, "Test move destination must not already exist")
    await rename(universal.path, moved)
    deliveries = await invoke("check_deliveries")
    assert.equal(deliveries.find((item) => item.id === claude.id).status, "ok")
    assert.equal(deliveries.find((item) => item.id === universal.id).status, "ok")
    assert.equal(await readFile(join(claude.path, "SKILL.md"), "utf8"), original)
    assert.equal(await readFile(join(universal.path, "SKILL.md"), "utf8"), await readFile(join(moved, "SKILL.md"), "utf8"))
    const backup = await event("deliveries://backed-up", (entry) => entry.targetId === claude.targetId && entry.reason === "modified")
    assert.match(backup.backupId, /^[A-Za-z0-9-]{1,64}$/u)
    const backupEntry = join(dataRoot, "backups", backup.backupId, claude.targetId)
    await assertTestRoot(backupEntry, { inspectContents: true })
    const backupMarker = JSON.parse(await readFile(join(backupEntry, ".cloudlink-backup.json"), "utf8"))
    assert.equal(backupMarker.managedBy, "cloudlink")
    assert.equal(backupMarker.targetId, claude.targetId)
    assert.equal(backupMarker.backupId, backup.backupId)
    const edited = `${original}\nExternal fixture edit\n`
    assert.equal(await readFile(join(backupEntry, "cloudlink-servers", "SKILL.md"), "utf8"), edited)
    const paused = await invoke("undo_backup", { backupId: backup.backupId })
    assert.equal(paused.id, claude.targetId)
    assert.equal(paused.enabled, false)
    assert.equal(await readFile(join(claude.path, "SKILL.md"), "utf8"), edited)
    await invoke("check_deliveries")
    assert.equal(await readFile(join(claude.path, "SKILL.md"), "utf8"), edited)
    assert.ok((await invoke("list_deliveries")).every((item) => item.targetId !== claude.targetId))
    await invoke("set_target_enabled", { id: claude.targetId, enabled: true })
    assert.equal(await readFile(join(claude.path, "SKILL.md"), "utf8"), original)
    for (const folder of [".claude", ".agents"]) assert.equal(await readFile(join(userRoot, folder, "skills", "existing", "SKILL.md"), "utf8"), preserved)
  })

  await check("failed live probe retains the last successful facts and invalidates verification", async () => {
    const before = await asset(saved.id)
    await target.stop()
    await waitFor(() => connectionRefused(target.port), "stopped SSH target refuses connections", 15_000)
    const { runId } = await invoke("start_probe", { assetId: saved.id })
    const result = await event("probe://finished", (entry) => entry.runId === runId)
    assert.equal(result.status, "failed")
    assert.equal(result.error?.id, "connection-refused")
    assert.equal(result.applied, undefined)
    assert.equal(result.held, undefined)
    const after = await asset(saved.id)
    assert.equal(after.probe.status, "failed")
    assert.equal(after.probe.lastRunId, runId)
    assert.equal(after.connection.verified.ok, false)
    for (const field of ["facts", "services", "listeningPorts"]) assert.deepEqual(after[field], before[field])
    assert.equal(after.probe.lastSuccessAt, before.probe.lastSuccessAt)
  })

  await check("reset removes managed resources and preserves user configuration", async () => {
    await invoke("remove_guard", { envId: "windows" })
    assert.equal(await readFile(join(userRoot, ".claude", "settings.json"), "utf8"), originalSettings)
    assert.equal((await invoke("install_guard", { envId: "windows" })).state, "active")
    const managedFiles = [
      join(userRoot, ".ssh", "cloudlink.conf"),
      join(dataRoot, "bin", "cloudlink-guard.exe"),
      join(dataRoot, "guard", "policy.json"),
    ]
    for (const path of managedFiles) assert.ok((await lstat(path)).isFile(), path)
    const keyPath = (await asset(saved.id)).connection.auth.identityFile.windows
    insideUserRoot(keyPath)
    const keyHash = createHash("sha256").update(await readFile(keyPath)).digest("hex")
    await invoke("reset_data")
    for (const path of managedFiles) assert.equal(await statIfPresent(path), null, path)
    assert.equal(await readFile(join(userRoot, ".claude", "settings.json"), "utf8"), originalSettings)
    assert.equal(createHash("sha256").update(await readFile(keyPath)).digest("hex"), keyHash)
    assert.deepEqual(await invoke("list_assets"), [])
    assert.deepEqual(await invoke("list_operations", { q: { limit: 50 } }), [])
    assert.deepEqual(await invoke("list_notes"), [])
    for (const folder of [".claude", ".agents"]) {
      assert.equal(await readFile(join(userRoot, folder, "skills", "existing", "SKILL.md"), "utf8"), preserved)
      assert.equal(await statIfPresent(join(userRoot, folder, "skills", "cloudlink-servers")), null)
    }
    assert.ok((await readFile(join(userRoot, ".ssh", "config"), "utf8")).endsWith(originalConfig))
    await page.reload()
    await expect(page.getByRole("heading", { name: "添加第一台服务器", exact: true })).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: join(runRoot, "03-native-reset.png") })
    assert.deepEqual(consoleErrors, [])
  })
} catch (error) {
  report.error = String(error)
  report.errorStack = error instanceof Error ? error.stack : undefined
  if (page) {
    report.ipcFailures = await page.evaluate(() => window.__cloudlinkDesktopFailures).catch(() => [])
    report.connectionAndProbeEvents = await page.evaluate(() => window.__cloudlinkDesktopEvents?.filter((entry) => ["connection://tested", "probe://finished"].includes(entry.event))).catch(() => [])
    report.compilation = await invoke("get_compile_status").catch(() => [])
    await page.screenshot({ path: join(runRoot, "failure.png") }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (desktop?.pid && desktop.exitCode === null) await run("taskkill.exe", ["/PID", String(desktop.pid), "/T", "/F"]).catch(() => {})
  if (target) await target.dispose().catch((error) => { report.cleanupError = String(error); process.exitCode = 1 })
  await writeFile(join(runRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Desktop report: ${join(runRoot, "report.json")}`)
  if (report.error) console.error(report.error)
}
