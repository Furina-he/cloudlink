// 端到端更新实测（EXECUTION-PLAN P6 第 8 项，F-406 AC1–AC6）：静默安装测试版 0.1.0，核对检查节奏、开关、下载取消、
// 忙碌拦截和签名篡改，再从顶栏提醒更新到 0.1.1，最后卸载。先运行 `pnpm build:update-test`，再运行 `pnpm e2e:update`
// （需要 WSL Docker 里的 SSH 靶机）。
//
// 应用数据全在 test-results/update/data：这个目录编译进了测试安装包（src-tauri/src/paths.rs），安装程序经资源管理器重新
// 打开的新版本也只认它。按当前用户安装会写真实的 HKCU 卸载项，所以实测结束时卸载，并清掉测试留下的安装位置键。
// 前后各记一次真实 Skills、ssh 配置、护栏设置、应用数据目录、快捷方式和注册表，必须完全一致。
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium, expect } from "@playwright/test"

import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"
import { DATA_HOME, DEBUG_PORT, INSTALL_DIR, PROJECT, ROOT, UPDATE_PORT, installerName } from "./update-test-config.mjs"

if (process.platform !== "win32") throw new Error("The update check requires Windows")

const OLD = "0.1.0"
const NEW = "0.1.1"
const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32")
const powershell = join(system32, "WindowsPowerShell", "v1.0", "powershell.exe")
const regExe = join(system32, "reg.exe")
const taskkill = join(system32, "taskkill.exe")
const wslExe = join(system32, "wsl.exe")
const installedExe = join(INSTALL_DIR, "cloudlink.exe")
const installedGuard = join(INSTALL_DIR, "cloudlink-guard.exe")
const uninstaller = join(INSTALL_DIR, "uninstall.exe")
const userHome = join(DATA_HOME, "home")
const guardDir = join(DATA_HOME, "bin")
const copiedGuard = join(guardDir, "cloudlink-guard.exe")
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CloudLink"
// NSIS 模板的 MANUKEY / MANUPRODUCTKEY。静默卸载只删「Installer Language」，默认值（安装目录）留着；
// 不清掉的话，用户以后正式安装时默认目录会指向这里的测试目录
const MANUFACTURER_KEY = "HKCU\\Software\\cloudlink"
const INSTALL_LOCATION_KEY = `${MANUFACTURER_KEY}\\CloudLink`
const DATA_MARKER = '{"managedBy":"cloudlink","kind":"data"}\n'

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const fileHash = async (path) => sha256(await readFile(path))
const samePath = (a, b) => a?.toLowerCase() === b.toLowerCase()

await assertTestRoot(ROOT)
const runRoot = await mkdtemp(join(ROOT, "run-"))
await assertTestRoot(runRoot)
const tmp = join(runRoot, "tmp")
const report = { root: runRoot, checks: [] }
const pageErrors = []
let launchError
let browser
let page
let target

async function waitFor(work, description, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await work()
    if (result) return result
    await delay(100)
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

const shot = (name) => page.screenshot({ path: join(runRoot, `${name}.png`) })
// 测试驱动直接跨过 WebView 调命令；应用代码仍然只经 src/lib/ipc.ts
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const invokeError = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args).then(() => null, (error) => error), { command, args })
const status = () => invoke("get_update_status")

// ---- 本地更新服务：只认 latest.json 和安装包，记下每一次请求 ----

const server = {
  requests: [],
  manifest: null,
  installer: null,
  /** 安装包分几块、每块间隔多少毫秒，界面才看得到进度 */
  chunks: 40,
  pause: 50,
  /** 0–1：发到这个比例就停住，直到客户端断开（取消下载用） */
  stallAt: null,
}
const requestsTo = (path) => server.requests.filter((item) => item.url === path).length
const http = createServer((request, response) => {
  server.requests.push({ at: Date.now(), method: request.method, url: request.url, userAgent: request.headers["user-agent"] })
  if (request.method === "GET" && request.url === "/latest.json" && server.manifest) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(server.manifest))
    return
  }
  if (request.method === "GET" && request.url === `/${installerName(NEW)}` && server.installer) {
    const bytes = server.installer
    const size = Math.ceil(bytes.length / server.chunks)
    const limit = server.stallAt === null ? bytes.length : Math.floor(bytes.length * server.stallAt)
    const pause = server.pause
    let offset = 0
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length })
    const send = () => {
      if (response.destroyed) return
      const end = Math.min(offset + size, limit)
      if (end > offset) response.write(bytes.subarray(offset, end))
      offset = end
      if (offset >= bytes.length) response.end()
      else if (offset < limit) setTimeout(send, pause)
    }
    send()
    return
  }
  response.writeHead(404)
  response.end()
})

async function manifestFor(version) {
  const out = join(runRoot, `latest-${version}.json`)
  const result = spawnSync(process.execPath, [
    join(PROJECT, "scripts", "release-manifest.mjs"),
    "--notes", `CloudLink ${version} update test\n- second line`,
    "--version", version,
    "--base-url", `http://127.0.0.1:${UPDATE_PORT}`,
    "--bundle-dir", join(ROOT, version),
    "--out", out,
  ], { encoding: "utf8", windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(await readFile(out, "utf8"))
}

// ---- 真实用户环境的快照：实测前后必须一致 ----

async function listing(directory) {
  let names
  try { names = await readdir(directory) }
  catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  const entries = []
  for (const name of names.sort()) {
    const info = await lstat(join(directory, name))
    entries.push(`${name}:${info.isDirectory() ? "dir" : info.size}:${info.mtimeMs}`)
  }
  return entries
}

const hashIfPresent = async (path) => (existsSync(path) ? fileHash(path) : null)

function wslSkills() {
  const result = spawnSync(wslExe, ["-d", "Ubuntu-24.04", "--exec", "sh", "-c", "ls -la --time-style=full-iso $HOME/.agents/skills"], { encoding: "utf8", windowsHide: true })
  return `${result.status}:${result.stdout}`
}

/** reg.exe 的输出：值缩进四个空格；默认值的名字随系统语言变化，统一记成 (default) */
function regKey(key) {
  const result = spawnSync(regExe, ["query", key], { encoding: "latin1", windowsHide: true })
  if (result.status !== 0) return null
  const self = key.replace(/^HKCU\\/i, "HKEY_CURRENT_USER\\").toLowerCase()
  const values = {}
  const subkeys = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const value = /^ {4}(.+?) {4}(REG_\w+) {4}(.*)$/.exec(line)
    if (value) values[/^\(.*\)$/.test(value[1]) ? "(default)" : value[1]] = value[3]
    else if (/^HKEY_/i.test(line) && line.toLowerCase() !== self) subkeys.push(line)
  }
  return { values, subkeys }
}

function regDelete(key) {
  assert.equal(spawnSync(regExe, ["delete", key, "/f"], { windowsHide: true }).status, 0, `reg delete ${key}`)
}

function powershellLines(script) {
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

async function realState() {
  const home = homedir()
  const [desktop, programs] = powershellLines("[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')")
  return {
    cloudlinkData: await listing(join(home, ".cloudlink")),
    claudeSkills: await listing(join(home, ".claude", "skills")),
    claudeSettings: await hashIfPresent(join(home, ".claude", "settings.json")),
    windowsAgentSkills: await listing(join(home, ".agents", "skills")),
    wslAgentSkills: wslSkills(),
    ssh: await listing(join(home, ".ssh")),
    sshConfig: await hashIfPresent(join(home, ".ssh", "config")),
    knownHosts: await hashIfPresent(join(home, ".ssh", "known_hosts")),
    localAppData: await listing(join(process.env.LOCALAPPDATA, "com.cloudlink.desktop")),
    roamingAppData: await listing(join(process.env.APPDATA, "com.cloudlink.desktop")),
    shortcuts: [join(desktop, "CloudLink.lnk"), join(programs, "CloudLink.lnk"), join(programs, "CloudLink")].filter((path) => existsSync(path)),
    uninstallKey: regKey(UNINSTALL_KEY),
    manufacturerKey: regKey(MANUFACTURER_KEY),
  }
}

// ---- 进程 ----

/** 只认这次装的那一份 cloudlink.exe：开发中的和用户自己的都不碰 */
function installedProcesses() {
  return powershellLines("Get-CimInstance Win32_Process -Filter \"Name='cloudlink.exe'\" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }")
    .map((line) => line.split("|"))
    .filter(([, path]) => samePath(path, installedExe))
    .map(([pid]) => Number(pid))
}

const debugEndpoint = () => fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((response) => response.ok, () => false)

async function disconnect() {
  await browser?.close().catch(() => {})
  browser = undefined
  page = undefined
}

async function stopApp() {
  await disconnect()
  // 先像用户关窗口一样发 WM_CLOSE，不响应再强制结束
  for (const pid of installedProcesses()) spawnSync(taskkill, ["/PID", String(pid)], { windowsHide: true })
  const closed = await waitFor(() => installedProcesses().length === 0, "CloudLink closes its window", 15_000).then(() => true, () => false)
  if (!closed) {
    report.forcedStops = (report.forcedStops ?? 0) + 1
    for (const pid of installedProcesses()) spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
    await waitFor(() => installedProcesses().length === 0, "CloudLink exits")
  }
  await waitFor(async () => !(await debugEndpoint()), "WebView2 releases the debugging port", 15_000)
}

/**
 * 第一次启动时固定 OpenSSH 会读的环境变量；安装程序重新打开的新版本拿到的是真实环境，只靠编译进来的目录隔离。
 * AppData 放在每轮新建的目录：WinINet 会在 LOCALAPPDATA 里建目录联接（INetCache\Content.IE5），
 * 放进固定的数据目录的话，下一轮清理时会因为里面有链接而拒绝删除
 */
function launch() {
  const env = {}
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "SystemDrive", "PATH", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]) {
    const entry = Object.entries(process.env).find(([name]) => name.toLowerCase() === key.toLowerCase())
    if (entry) env[entry[0]] = entry[1]
  }
  Object.assign(env, {
    HOME: userHome,
    USERPROFILE: userHome,
    APPDATA: join(runRoot, "AppData", "Roaming"),
    LOCALAPPDATA: join(runRoot, "AppData", "Local"),
    ProgramData: join(runRoot, "ProgramData"),
    TEMP: tmp,
    TMP: tmp,
  })
  launchError = undefined
  const child = spawn(installedExe, [], { cwd: runRoot, env, stdio: "ignore" })
  child.once("error", (error) => { launchError = error })
}

async function connect() {
  await waitFor(async () => {
    if (launchError) throw launchError
    return debugEndpoint()
  }, "WebView2 debugging endpoint", 120_000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
  page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith("http://tauri.localhost")), "application page")
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 30_000 })
}

// ---- 界面 ----

const reminder = () => page.getByRole("banner").getByRole("button", { name: /新版本|下载中|正在安装/ })
const dialog = () => page.getByRole("dialog", { name: /^新版本 / })
const dialogButton = (name) => dialog().getByRole("button", { name, exact: true })

/** 关掉再打开检查开关：后端立即重新读清单，状态回到干净的「有新版本」 */
async function recheck(version) {
  await invoke("update_settings", { patch: { autoCheckUpdates: false } })
  await invoke("update_settings", { patch: { autoCheckUpdates: true } })
  await waitFor(async () => {
    const current = await status()
    return current.state === "available" && current.version === version && !current.error
  }, `update ${version} is offered`)
}

async function installFails(version, errorId, text, label) {
  await recheck(version)
  await reminder().click()
  await dialogButton("下载并安装").click()
  await expect(dialog().locator("[data-slot=alert]")).toContainText(text, { timeout: 60_000 })
  const current = await status()
  assert.equal(current.state, "available")
  assert.equal(current.error?.id, errorId)
  await shot(`rejected-${label}`)
  await dialogButton("稍后").click()
  await expect(dialog()).toHaveCount(0)
  assert.equal(await fileHash(installedExe), report.oldExe, "A rejected update must not change the installed application")
  assert.equal((await status()).currentVersion, OLD)
  assert.deepEqual(installedProcesses(), [report.pid], "A rejected update must not restart CloudLink")
}

/**
 * 冷启动计时（PRD 第九章：不超过 1.5 秒）。spawnedAt 是启动进程前记下的时间；页面里的时间都相对 performance.timeOrigin，
 * 换算成相对启动进程的毫秒数。首屏以最后一次 Largest Contentful Paint 为准，同时记下 list_assets 返回的时间作对照
 */
async function startupTiming(label, spawnedAt) {
  const timing = await page.evaluate(async () => {
    const lcp = await new Promise((resolve) => {
      const entries = []
      const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()))
      observer.observe({ type: "largest-contentful-paint", buffered: true })
      setTimeout(() => {
        observer.disconnect()
        resolve(entries)
      }, 300)
    })
    const last = lcp.at(-1)
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]
    const navigation = performance.getEntriesByType("navigation")[0]
    const ipc = performance.getEntriesByType("resource").filter((entry) => entry.name.startsWith("http://ipc.localhost/"))
    const listAssets = ipc.find((entry) => entry.name.startsWith("http://ipc.localhost/list_assets"))
    return {
      timeOrigin: performance.timeOrigin,
      domContentLoaded: navigation ? navigation.domContentLoadedEventEnd : null,
      fcp: fcp ? fcp.startTime : null,
      lcp: last ? last.startTime : null,
      lcpElement: last?.element ? `${last.element.tagName.toLowerCase()} ${(last.element.textContent ?? "").trim().slice(0, 40)}` : null,
      listAssets: listAssets ? listAssets.responseEnd : null,
    }
  })
  const at = (ms) => (ms === null ? null : Math.round(timing.timeOrigin + ms - spawnedAt))
  const entry = {
    label,
    navigationStartMs: at(0),
    domContentLoadedMs: at(timing.domContentLoaded),
    firstContentfulPaintMs: at(timing.fcp),
    firstScreenMs: at(timing.lcp),
    firstScreenElement: timing.lcpElement,
    listAssetsMs: at(timing.listAssets),
  }
  report.startup = [...(report.startup ?? []), entry]
  return entry
}

/** 回路行上点亮的 Agent：两份副本都分发了，行上就是两个按下的开关；冷启动时目标检测完成前什么都不写 */
async function rowAgentsLit(alias) {
  const group = page.getByRole("group", { name: `将 ${alias} 分发给哪些 Agent` })
  await expect(group.locator("[aria-pressed=true]")).toHaveCount(2, { timeout: 15_000 })
  await expect(page.getByText("没有启用的 Agent")).toHaveCount(0)
}

const activityCount = async (kind) => (await invoke("list_activity", { q: { limit: 100, kinds: [kind] } })).length

/** 托管 ssh 配置、护栏 hook、两份分发副本和用户自己的 Skill：更新前后逐字节比较 */
async function userFiles() {
  const files = [
    join(userHome, ".ssh", "cloudlink.conf"),
    join(userHome, ".ssh", "config"),
    join(userHome, ".claude", "settings.json"),
    join(userHome, ".claude", "skills", "cloudlink-servers", "SKILL.md"),
    join(userHome, ".agents", "skills", "cloudlink-servers", "SKILL.md"),
    join(userHome, ".claude", "skills", "existing", "SKILL.md"),
    join(userHome, ".agents", "skills", "existing", "SKILL.md"),
  ]
  const hashes = {}
  for (const file of files) hashes[file] = await fileHash(file)
  return hashes
}

const originalSettings = '{\n  "theme": "dark"\n}\n'
const preserved = "Existing user skill fixture — keep these bytes.\n"

/**
 * 只删链接本身、不跟随：对目录联接调 RemoveDirectory、对文件链接调 DeleteFile 都不会碰到链接目标。
 * WinINet 按 %USERPROFILE% 在测试家目录里建 INetCache\Content.IE5 联接；USERPROFILE 又必须指向测试家目录
 * （Windows 版 OpenSSH 不看 HOME），所以每轮清理前先拆掉这些链接
 */
function unlinkReparsePoints(root) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$pending = [Collections.Generic.Stack[string]]::new()
$pending.Push([IO.Path]::GetFullPath($env:CLOUDLINK_TEST_PATH))
while ($pending.Count) {
  foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
    $attributes = [IO.File]::GetAttributes($entry)
    if (($attributes -band 0x400) -ne 0) {
      if (($attributes -band 0x10) -ne 0) { [IO.Directory]::Delete($entry) } else { [IO.File]::Delete($entry) }
      $entry
    } elseif (($attributes -band 0x10) -ne 0) { $pending.Push($entry) }
  }
}`
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, env: { SystemRoot: process.env.SystemRoot, CLOUDLINK_TEST_PATH: root },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

async function prepareFixtures() {
  // 目录是编译进安装包的固定路径，上一轮的数据要清掉：只清带 CloudLink 数据标记的目录，拆掉链接后确认已经没有链接
  if (existsSync(DATA_HOME)) {
    await assertTestRoot(DATA_HOME)
    const marker = await readFile(join(DATA_HOME, ".cloudlink.json"), "utf8").catch(() => null)
    assert.equal(marker, DATA_MARKER, `${DATA_HOME} is not a CloudLink data directory; remove it by hand`)
    report.unlinked = unlinkReparsePoints(DATA_HOME)
    await assertTestRoot(DATA_HOME, { inspectContents: true })
    await rm(DATA_HOME, { recursive: true })
  }
  await mkdir(DATA_HOME, { recursive: true })
  // 和应用第一次启动时写的标记相同；先写好，这一轮中途失败时下一轮也能认出并清掉
  await writeFile(join(DATA_HOME, ".cloudlink.json"), DATA_MARKER, { flag: "wx" })
  for (const directory of [join(userHome, ".ssh"), join(userHome, ".claude", "skills", "existing"), join(userHome, ".agents", "skills", "existing"), join(userHome, ".codex"), join(runRoot, "AppData", "Roaming"), join(runRoot, "AppData", "Local"), tmp, join(runRoot, "ProgramData")]) {
    await mkdir(directory, { recursive: true })
  }
  await writeFile(join(userHome, ".claude", "settings.json"), originalSettings)
  for (const folder of [".claude", ".agents"]) await writeFile(join(userHome, folder, "skills", "existing", "SKILL.md"), preserved)
  // Windows 版 OpenSSH 找配置时不看 HOME，每一项回退都在这里钉死
  const knownHosts = join(userHome, ".ssh", "known_hosts").replaceAll("\\", "/")
  await writeFile(join(userHome, ".ssh", "config"), `# Existing SSH configuration fixture\nHost *\n  UserKnownHostsFile "${knownHosts}"\n  GlobalKnownHostsFile none\n  IdentityAgent none\n  IdentityFile none\n`)
  await writeFile(join(userHome, ".ssh", "known_hosts"), "")
}

const tempEnv = () => ({ ...process.env, TEMP: tmp, TMP: tmp })

async function uninstall() {
  await stopApp()
  if (existsSync(uninstaller)) {
    const result = spawnSync(uninstaller, ["/S"], { env: tempEnv(), windowsHide: true })
    assert.equal(result.status, 0, "uninstaller exit code")
  }
  // NSIS 卸载程序先把自己复制到临时目录再运行，这里等文件和卸载项真正删掉
  await waitFor(() => !existsSync(installedExe) && !existsSync(uninstaller) && !regKey(UNINSTALL_KEY), "uninstaller finishes", 60_000)
  if (!report.before.manufacturerKey) {
    const location = regKey(INSTALL_LOCATION_KEY)
    if (location) {
      assert.ok(samePath(location.values["(default)"], INSTALL_DIR) && location.subkeys.length === 0, `Only the key this test wrote may be removed: ${JSON.stringify(location)}`)
      regDelete(INSTALL_LOCATION_KEY)
    }
    const manufacturer = regKey(MANUFACTURER_KEY)
    if (manufacturer) {
      assert.deepEqual(manufacturer, { values: {}, subkeys: [] }, "The manufacturer key must be empty before removing it")
      regDelete(MANUFACTURER_KEY)
    }
  }
}

let installed = false
try {
  await check("nothing is installed yet; real user files are recorded; isolated fixtures are ready", async () => {
    report.before = await realState()
    assert.equal(report.before.uninstallKey, null, "CloudLink is installed on this machine: uninstall it before running the update check")
    assert.equal(report.before.manufacturerKey, null, `${MANUFACTURER_KEY} exists: an earlier installation is left over`)
    assert.deepEqual(installedProcesses(), [])
    assert.ok(!existsSync(INSTALL_DIR), `${INSTALL_DIR} is left over from an earlier run`)
    assert.equal(await debugEndpoint(), false, `Port ${DEBUG_PORT} is already in use`)
    await prepareFixtures()
    await new Promise((done, reject) => { http.once("error", reject); http.listen(UPDATE_PORT, "127.0.0.1", done) })
  })

  await check(`installer ${OLD} installs for the current user without elevation or shortcuts`, async () => {
    installed = true
    const result = spawnSync(join(ROOT, OLD, installerName(OLD)), ["/S", "/NS", `/D=${INSTALL_DIR}`], { env: tempEnv(), windowsHide: true })
    assert.equal(result.status, 0, "installer exit code")
    await waitFor(() => existsSync(installedExe) && existsSync(installedGuard) && existsSync(uninstaller), "installed files")
    const key = await waitFor(() => regKey(UNINSTALL_KEY), "uninstall key")
    assert.equal(key.values.DisplayVersion, OLD)
    assert.equal(key.values.DisplayIcon, `"${installedExe}"`)
    assert.equal(key.values.UninstallString, `"${uninstaller}"`)
    report.oldExe = await fileHash(installedExe)
    report.oldGuard = await fileHash(installedGuard)
    assert.deepEqual((await realState()).shortcuts, report.before.shortcuts, "/NS must not add desktop or Start menu shortcuts")
  })

  await check("AC6: the first check runs ten seconds after start; no newer version leaves the interface unchanged", async () => {
    server.manifest = { ...(await manifestFor(NEW)), version: OLD }
    const started = Date.now()
    launch()
    await connect()
    report.pid = installedProcesses()[0]
    await expect(page.getByText("还没有资源", { exact: true })).toBeVisible()
    // 装好后的第一次启动要新建 WebView2 的配置目录，只记录，不算进冷启动
    await startupTiming("first launch after install", started)
    const settings = await invoke("get_settings")
    assert.equal(settings.dataDir, DATA_HOME, "The compiled test home must isolate the application")
    assert.equal(settings.autoCheckUpdates, true)
    assert.deepEqual(await status(), { state: "idle", currentVersion: OLD })
    await waitFor(() => requestsTo("/latest.json") > 0, "first update check", 30_000)
    report.firstCheckMs = server.requests[0].at - started
    assert.ok(report.firstCheckMs >= 10_000, `first check came ${report.firstCheckMs}ms after launch`)
    await delay(1_000)
    assert.equal((await status()).state, "idle")
    await expect(reminder()).toHaveCount(0)
    await shot("01-installed-idle")
  })

  await check("a verified server, two delivered copies, the managed ssh config and the guard hook exist", async () => {
    target = await startSshTarget({ root: runRoot })
    await page.getByRole("button", { name: "添加 SSH 服务器", exact: true }).click()
    const form = page.getByRole("region", { name: "添加 SSH 服务器" })
    await form.getByLabel("地址").fill(target.host)
    await form.getByLabel("端口", { exact: true }).fill(String(target.port))
    await form.getByLabel("用户").fill(target.user)
    await form.getByRole("radio", { name: "密码", exact: true }).or(form.getByRole("button", { name: "密码", exact: true })).click()
    await form.getByLabel("密码", { exact: true }).fill(target.password)
    await form.getByLabel(/^名称/).fill("Update SSH")
    await form.getByRole("button", { name: /连接并启用/ }).click()
    const trust = page.getByRole("alertdialog").filter({ hasText: "SHA256:" })
    await expect(trust).toBeVisible({ timeout: 30_000 })
    await expect(trust).toContainText(target.hostKeyFingerprint)
    await trust.getByRole("button", { name: /信任/ }).click()
    const include = page.getByRole("alertdialog").filter({ hasText: "Include" })
    await expect(include).toBeVisible({ timeout: 30_000 })
    await include.getByRole("button", { name: "加入 Include", exact: true }).click()
    await expect(form).toBeHidden({ timeout: 60_000 })
    // 保存后自动探测；活动记录在发布之后才写，等到它说明这一轮编译和分发都结束了
    await waitFor(async () => (await activityCount("probe")) > 0, "first probe is published", 120_000)
    const [saved] = await invoke("list_assets")
    assert.equal(saved.connection.verified.ok, true)
    assert.equal(saved.probe.status, "ok")
    const deliveries = await invoke("check_deliveries")
    assert.equal(deliveries.length, 2)
    assert.ok(deliveries.every((item) => item.status === "ok"), JSON.stringify(deliveries))
    assert.equal((await invoke("install_guard", { envId: "windows" })).state, "active")
    assert.equal(await fileHash(copiedGuard), report.oldGuard)
    await rowAgentsLit(saved.connection.sshAlias)
    await shot("02-seeded")
  })

  await check("AC6: turning checks off stops requests across a restart; turning them on checks at once", async () => {
    await page.keyboard.press("Control+3")
    await expect(page.getByText(`当前版本 ${OLD}`)).toBeVisible()
    const toggle = page.getByRole("switch", { name: "自动检查更新" })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await waitFor(async () => (await invoke("get_settings")).autoCheckUpdates === false, "the switch is saved")
    await stopApp()

    const since = Date.now()
    launch()
    await connect()
    report.pid = installedProcesses()[0]
    assert.equal((await invoke("get_settings")).autoCheckUpdates, false)
    await delay(Math.max(0, since + 20_000 - Date.now()))
    assert.deepEqual(server.requests.filter((item) => item.at >= since), [], "No request may be sent while checks are off")

    await page.keyboard.press("Control+3")
    const clicked = Date.now()
    await page.getByRole("switch", { name: "自动检查更新" }).click()
    const request = await waitFor(() => server.requests.find((item) => item.at >= clicked), "check right after switching on", 10_000)
    report.checkAfterSwitchOnMs = request.at - clicked
    assert.ok(report.checkAfterSwitchOnMs < 3_000, `check came ${report.checkAfterSwitchOnMs}ms after switching on`)
    await page.keyboard.press("Control+1")
  })

  await check(`AC1/AC2: ${NEW} brings a quiet reminder and plain-text notes; cancelling a real download keeps ${OLD}`, async () => {
    server.manifest = await manifestFor(NEW)
    server.installer = await readFile(join(ROOT, NEW, installerName(NEW)))
    server.stallAt = 0.4
    await recheck(NEW)
    await expect(reminder()).toHaveAccessibleName(`有新版本 ${NEW}，查看并更新`)
    await expect(page.getByRole("banner").locator("[aria-live=polite]")).toHaveText(`有新版本 ${NEW}`)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await shot("03-reminder")

    await reminder().click()
    await expect(dialog()).toBeVisible()
    await expect(dialog().getByText(new RegExp(`^当前版本 ${OLD.replaceAll(".", "\\.")} · 发布于 \\d{4}-\\d{2}-\\d{2}$`))).toBeVisible()
    const notes = dialog().locator("[data-slot=scroll-area] p")
    assert.equal(await notes.evaluate((element) => element.innerText), `CloudLink ${NEW} update test\n- second line`)
    await expect(dialogButton("下载并安装")).toBeFocused()

    await dialogButton("下载并安装").click()
    await expect(dialog().getByRole("progressbar")).toBeVisible()
    await waitFor(async () => (await status()).downloaded > 0, "download progress")
    await expect(dialog().getByText(/^已下载 .+ \/ .+$/)).toBeVisible()
    await shot("04-downloading")
    // 模态对话框打开时顶栏不在无障碍树里：关掉对话框再看提醒，下载照常进行
    await dialogButton("稍后").click()
    await expect(dialog()).toHaveCount(0)
    await expect(reminder()).toHaveAccessibleName(/^下载中 \d+%，查看更新$/)
    assert.equal((await status()).state, "downloading")
    await reminder().click()
    await dialogButton("取消下载").click()
    await expect(dialogButton("下载并安装")).toBeEnabled({ timeout: 10_000 })
    const current = await status()
    assert.equal(current.state, "available")
    assert.equal(current.error, undefined)
    assert.equal(current.downloaded, undefined)
    await dialogButton("稍后").click()
    await expect(dialog()).toHaveCount(0)
    await expect(reminder()).toBeFocused()
    assert.equal(await fileHash(installedExe), report.oldExe)
    assert.deepEqual(installedProcesses(), [report.pid])
    server.stallAt = null
  })

  await check("AC4: a running probe blocks installing, even when the interface is bypassed", async () => {
    // 万一探测比预期结束得早，下载也只会失败，不会真的安装
    server.installer = null
    await recheck(NEW)
    const probes = await activityCount("probe")
    const [saved] = await invoke("list_assets")
    await invoke("start_probe", { assetId: saved.id })
    const error = await invokeError("install_update")
    assert.equal(error?.id, "update-busy", JSON.stringify(error))
    assert.deepEqual(error.params, { task: "probe", name: saved.connection.sshAlias })
    assert.equal((await status()).state, "available")
    await waitFor(async () => (await activityCount("probe")) > probes, "probe is published", 120_000)
  })

  await check("AC3: tampered packages, signatures and versions are rejected and nothing is installed", async () => {
    const good = await manifestFor(NEW)
    const goodPackage = await readFile(join(ROOT, NEW, installerName(NEW)))
    const signatureText = "安装包签名校验失败"

    const tampered = Buffer.from(goodPackage)
    tampered[tampered.length >> 1] ^= 0xff
    server.manifest = good
    server.installer = tampered
    await installFails(NEW, "update-signature-invalid", signatureText, "tampered-package")

    // 格式正确、内容错误的签名
    const lines = Buffer.from(good.platforms["windows-x86_64"].signature, "base64").toString("utf8").split("\n")
    const raw = Buffer.from(lines[1], "base64")
    raw[raw.length - 1] ^= 1
    lines[1] = raw.toString("base64")
    server.installer = goodPackage
    server.manifest = structuredClone(good)
    server.manifest.platforms["windows-x86_64"].signature = Buffer.from(lines.join("\n")).toString("base64")
    await installFails(NEW, "update-signature-invalid", signatureText, "wrong-signature")

    // 清单里的版本号不在签名范围内：把合法的 0.1.1 安装包说成 0.1.2 也不能通过（requireSignedVersion）
    server.manifest = { ...structuredClone(good), version: "0.1.2" }
    await installFails("0.1.2", "update-signature-invalid", signatureText, "unsigned-version")

    server.manifest = good
    server.installer = null
    await installFails(NEW, "update-download-failed", "下载安装包失败", "missing-package")
  })

  await check(`AC5: updating from the reminder exits, installs passively and reopens ${NEW} with everything intact`, async () => {
    // 两个测试版的护栏程序出自同一份源码。把数据目录里的副本连同标记改成「旧版写下的样子」，才看得出启动时按哈希同步了新版
    await appendFile(copiedGuard, Buffer.alloc(16, 0x20))
    const markerPath = join(guardDir, ".cloudlink.json")
    const marker = JSON.parse(await readFile(markerPath, "utf8"))
    assert.equal(marker.kind, "guard-bin")
    await writeFile(markerPath, JSON.stringify({ ...marker, hash: await fileHash(copiedGuard) }))
    assert.equal((await invoke("get_guard_status")).find((item) => item.envId === "windows")?.state, "active")

    report.assets = await invoke("list_assets")
    report.files = await userFiles()
    const deliveriesBefore = await invoke("check_deliveries")
    assert.ok(deliveriesBefore.every((item) => item.status === "ok"), JSON.stringify(deliveriesBefore))

    server.manifest = await manifestFor(NEW)
    server.installer = await readFile(join(ROOT, NEW, installerName(NEW)))
    server.chunks = 60
    server.pause = 100
    await recheck(NEW)
    const checksBefore = requestsTo("/latest.json")
    await reminder().click()
    await dialogButton("下载并安装").click()
    await expect(dialog().getByRole("progressbar")).toBeVisible()
    await shot("05-updating")
    await disconnect()

    const oldPid = report.pid
    await waitFor(() => regKey(UNINSTALL_KEY)?.values.DisplayVersion === NEW, "installer registers the new version", 180_000)
    report.pid = await waitFor(() => installedProcesses().find((pid) => pid !== oldPid), "installer reopens CloudLink", 120_000)
    assert.notEqual(await fileHash(installedExe), report.oldExe)
    await connect()

    const settings = await invoke("get_settings")
    assert.equal(settings.dataDir, DATA_HOME, "The reopened application must stay isolated")
    assert.equal(settings.autoCheckUpdates, true)
    assert.deepEqual(await status(), { state: "idle", currentVersion: NEW })
    await expect(reminder()).toHaveCount(0)
    await rowAgentsLit(report.assets[0].connection.sshAlias)
    await shot("06-reopened")

    assert.deepEqual(await invoke("list_assets"), report.assets)
    assert.deepEqual(await userFiles(), report.files)
    const deliveries = await invoke("check_deliveries")
    assert.equal(deliveries.length, 2)
    assert.ok(deliveries.every((item) => item.status === "ok"), JSON.stringify(deliveries))
    assert.equal((await invoke("get_guard_status")).find((item) => item.envId === "windows")?.state, "active")
    assert.equal(await fileHash(copiedGuard), await fileHash(installedGuard), "The guard copy must be synchronized with the new version")

    const activity = await invoke("list_activity", { q: { limit: 10, kinds: ["update"] } })
    assert.equal(activity.length, 1)
    assert.equal(activity[0].messageId, "update-installing")
    assert.deepEqual(activity[0].params, { from: OLD, to: NEW })

    await waitFor(() => requestsTo("/latest.json") > checksBefore, "the new version checks for updates", 30_000)
    await delay(1_000)
    assert.deepEqual(await status(), { state: "idle", currentVersion: NEW })
    await expect(reminder()).toHaveCount(0)
  })

  await check(`cold start: ${NEW} with a saved server reaches its first screen within 1.5 seconds`, async () => {
    // 冷启动（PRD 第九章）：已经用过、有数据的安装，关掉再打开，连续三次取中位数
    const alias = report.assets[0].connection.sshAlias
    const restarts = []
    for (let i = 1; i <= 3; i++) {
      await stopApp()
      const spawnedAt = Date.now()
      launch()
      await connect()
      report.pid = installedProcesses()[0]
      await expect(page.getByRole("button", { name: new RegExp(`^${alias}，`) })).toBeVisible()
      restarts.push(await startupTiming(`restart ${i}`, spawnedAt))
    }
    const firstScreens = restarts.map((item) => item.firstScreenMs)
    assert.ok(firstScreens.every((ms) => typeof ms === "number"), JSON.stringify(restarts))
    report.coldStartMedianMs = [...firstScreens].sort((a, b) => a - b)[1]
    assert.ok(report.coldStartMedianMs <= 1_500, `cold start median ${report.coldStartMedianMs}ms: ${JSON.stringify(restarts)}`)
  })

  await check(`the uninstaller removes ${NEW} and keeps user data`, async () => {
    await uninstall()
    installed = false
    for (const path of [join(DATA_HOME, "data.db"), join(userHome, ".claude", "skills", "cloudlink-servers", "SKILL.md"), copiedGuard]) {
      assert.ok(existsSync(path), `Uninstalling must keep ${path}`)
    }
  })

  await check("real user files, shortcuts and registry are exactly as before", async () => {
    report.after = await realState()
    assert.deepEqual(report.after, report.before)
    assert.deepEqual(pageErrors, [])
    report.requests = server.requests.map(({ method, url, userAgent }) => `${method} ${url} (${userAgent})`)
    assert.ok(server.requests.every((item) => item.url === "/latest.json" || item.url === `/${installerName(NEW)}`))
  })
} catch (error) {
  report.error = String(error)
  report.errorStack = error instanceof Error ? error.stack : undefined
  if (page) await page.screenshot({ path: join(runRoot, "failure.png") }).catch(() => {})
  process.exitCode = 1
} finally {
  await disconnect()
  if (installed) {
    await uninstall().catch((error) => {
      report.cleanupError = String(error)
      process.exitCode = 1
    })
  }
  http.closeAllConnections()
  await new Promise((done) => http.close(done))
  if (target) await target.dispose().catch((error) => { report.targetCleanupError = String(error); process.exitCode = 1 })
  if (report.before && !report.after) {
    report.after = await realState()
    if (JSON.stringify(report.after) !== JSON.stringify(report.before)) {
      report.realStateChanged = true
      console.error("REAL USER STATE CHANGED: compare report.before and report.after")
    }
  }
  await writeFile(join(runRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Update report: ${join(runRoot, "report.json")}`)
  if (report.error) console.error(report.error)
  if (report.cleanupError) console.error(`CLEANUP FAILED: ${report.cleanupError}`)
}
