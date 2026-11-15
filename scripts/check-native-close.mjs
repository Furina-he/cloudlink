// Narrow actual caption-click diagnosis, scoped to a fresh isolated executable.
// Posted SC_CLOSE is recorded separately and never substituted for mouse delivery.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"
import { assertTestRoot } from "./desktop-ssh-target.mjs"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const evidence = await assertTestRoot(resolve(process.argv[2]))
assert.equal(JSON.parse(await readFile(join(evidence, ".cloudlink.json"), "utf8")).kind, "p8-evidence")
const tools = await assertTestRoot(resolve(process.argv[3]))
const matrix = process.argv[4] === "matrix"
if (process.argv[4] && !matrix) throw new Error("Only the matrix fixture option is supported")
const root = await mkdtemp(join(evidence, "native-close-"))
const home = join(root, "home"), data = join(root, "data"), app = join(root, "application/cloudlink.exe")
for (const path of [home, data, dirname(app), join(home, "AppData/Roaming"), join(home, "AppData/Local"), join(root, "tmp"), join(root, "ProgramData")]) await mkdir(path, { recursive: true })
await writeFile(join(root, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "p8-execution-lifecycle" }), { flag: "wx" })
await writeFile(join(dirname(app), ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "desktop-test-binary" }), { flag: "wx" })
for (const name of ["cloudlink.exe", "cloudlink-guard.exe"]) await copyFile(join(project, "src-tauri/target/debug", name), join(dirname(app), name), constants.COPYFILE_EXCL)
const system = process.env.SystemRoot || "C:\\Windows", powershell = join(system, "System32/WindowsPowerShell/v1.0/powershell.exe")
const env = { SystemRoot: system, WINDIR: system, PATH: process.env.PATH, PATHEXT: process.env.PATHEXT,
  CLOUDLINK_HOME: data, CLOUDLINK_USER_HOME: home, CLOUDLINK_WSL_ROOT: join(root, "wsl"), CLOUDLINK_FAKE_WSL: "",
  HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
  TEMP: join(root, "tmp"), TMP: join(root, "tmp"), ProgramData: join(root, "ProgramData"), PSModuleAnalysisCachePath: "NUL",
  CLOUDLINK_P8_EXE: app, CLOUDLINK_P8_EVIDENCE_ROOT: root }
let desktop, browser
const report = { root, snapshots: [] }
const run = (program, args, extra = {}) => {
  const child = spawn(program, args, { cwd: home, env: { ...env, ...extra }, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  const result = new Promise((done, reject) => {
    let stdout = "", stderr = ""
    const timer = setTimeout(() => { child.kill(); reject(new Error("Native close fixture timed out")) }, 120_000)
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", (bytes) => { stdout += bytes })
    child.stderr.on("data", (bytes) => { stderr += bytes })
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }) })
  })
  return { child, result }
}
const waitFor = async (work) => {
  const end = Date.now() + 60_000
  while (Date.now() < end) { const result = await work(); if (result) return result; await new Promise((done) => setTimeout(done, 100)) }
  throw new Error("Native close startup timed out")
}
const native = async (file, args, extra = {}) => {
  assert.ok(["window-tools.ps1", "native-interaction-tools.ps1"].includes(file))
  const result = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(tools, file), ...args], { CLOUDLINK_P8_PID: String(desktop.pid), ...extra }).result
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout.trim())
}
try {
  const socket = createServer()
  await new Promise((done) => socket.listen(0, "127.0.0.1", done))
  const port = socket.address().port
  await new Promise((done) => socket.close(done))
  const launch = run(app, [], { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` })
  desktop = launch.child; desktop.completion = launch.result
  await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.ok).catch(() => false))
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith("http://tauri.localhost")))
  await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeAttached()
  const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
  await invoke("update_settings", { patch: { autoCheckUpdates: false, closeToTray: true } })
  report.settings = await invoke("get_settings")
  report.before = await native("window-tools.ps1", ["-Mode", "inspect"])
  assert.equal(report.before.visible, true, "Native checks require the visible tauri.native.conf.json startup path")
  if (matrix) {
    report.windowMatrix = []
    for (const nav of ["top", "side"]) for (const theme of ["light", "dark"]) for (const [width, height] of [[1000, 680], [760, 520]]) {
      await page.evaluate(({ nav, theme }) => { localStorage.setItem("cloudlink-nav-position", nav); localStorage.setItem("theme", theme) }, { nav, theme })
      await page.reload({ waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { level: 1, name: "资源" })).toBeAttached()
      await waitFor(() => page.evaluate((theme) => document.documentElement.classList.contains(theme), theme))
      await native("window-tools.ps1", ["-Mode", "resize"], { CLOUDLINK_P8_WIDTH: String(width), CLOUDLINK_P8_HEIGHT: String(height) })
      const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
      assert.equal(metrics.width, width); assert.equal(metrics.height, height)
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1)
      const image = join(root, `matrix-${nav}-${theme}-${width}.png`)
      const shot = await native("window-tools.ps1", ["-Mode", "capture"], { CLOUDLINK_P8_SHOT: image })
      assert.equal(shot.dark.value, theme === "dark" ? 1 : 0)
      report.windowMatrix.push({ nav, theme, width, height, metrics, shot })
      console.log(`PASS native matrix ${nav}/${theme}/${width}x${height}`)
    }
  }
  const inspect = String.raw`$ErrorActionPreference='Stop'; . ([IO.Path]::Combine($env:CLOUDLINK_P8_TOOLS,'window-tools.ps1')) -Mode inspect | Out-Null; Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ClP8CloseState {
[DllImport("user32.dll")] public static extern IntPtr GetSystemMenu(IntPtr window,bool revert);
[DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr menu,uint item,uint flags);
[DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
}
'@; $menu=[ClP8CloseState]::GetSystemMenu($h,$false); @{enabled=[ClP8CloseState]::IsWindowEnabled($h);closeMenuState=[ClP8CloseState]::GetMenuState($menu,0xf060,0);input=(Input-State)} | ConvertTo-Json -Depth 6 -Compress`
  // Input-State is declared by the interaction helper; its state action sends no input.
  const inspectCode = inspect.replace("'window-tools.ps1')) -Mode inspect", "'native-interaction-tools.ps1')) -Action state")
  const info = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", inspectCode], { CLOUDLINK_P8_PID: String(desktop.pid), CLOUDLINK_P8_TOOLS: tools }).result
  assert.equal(info.code, 0, info.stderr); report.systemState = JSON.parse(info.stdout.trim())
  report.beforeShot = await native("window-tools.ps1", ["-Mode", "capture"], { CLOUDLINK_P8_SHOT: join(root, "01-native-close-before.png") })
  const start = Date.now()
  report.close = await native("native-interaction-tools.ps1", ["-Action", "caption-close"])
  report.returnedMs = Date.now() - start
  for (let index = 0; index < 4; index++) {
    const state = await native("window-tools.ps1", ["-Mode", "inspect"])
    report.snapshots.push({ ms: Date.now() - start, ...state })
    if (!state.visible) break
  }
  report.runtime = await invoke("get_runtime_status")
  report.mouseClosePassed = report.snapshots.some((state) => !state.visible) && report.runtime.state === "active"
  if (!report.mouseClosePassed) {
    report.afterShot = await native("window-tools.ps1", ["-Mode", "capture"], { CLOUDLINK_P8_SHOT: join(root, "02-native-close-after.png") })
    const result = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(project, "scripts/close-isolated-window.ps1")], { CLOUDLINK_P8_PID: String(desktop.pid) }).result
    assert.equal(result.code, 0, result.stderr)
    report.postedClose = JSON.parse(result.stdout.trim())
    report.postedCloseAfter = await native("window-tools.ps1", ["-Mode", "inspect"])
  }
  console.log(JSON.stringify({ root, enabled: report.systemState.enabled, closeMenuState: report.systemState.closeMenuState, mouseClosePassed: report.mouseClosePassed, postedCloseVisible: report.postedCloseAfter?.visible }))
} finally {
  if (desktop?.exitCode === null) { desktop.kill(); await desktop.completion.catch(() => {}) }
  await browser?.close().catch(() => {})
  await writeFile(join(root, "result.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" })
}
