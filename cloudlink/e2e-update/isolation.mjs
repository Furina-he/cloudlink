import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import { assertTestRoot } from "../scripts/desktop-ssh-target.mjs"
import { DEBUG_PORT, PROJECT, ROOT, UPDATE_PORT, VERSIONS, installerName, layout } from "../scripts/update-test-config.mjs"

export const systemDirectory = "C:/Windows/System32"
export const powershell = join(systemDirectory, "WindowsPowerShell/v1.0/powershell.exe")
export const tauriCli = join(PROJECT, "node_modules/@tauri-apps/cli/tauri.js")
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")

// Tauri patches this one runtime marker for the NSIS payload, then restores UNK
// in target/release. Compare every payload byte against that documented patch;
// never weaken the installed-file check to size, version or a partial hash.
export function nsisPayloadHash(archived) {
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK")
  const offset = archived.indexOf(marker)
  assert.ok(offset >= 0 && archived.indexOf(marker, offset + 1) === -1, "Expected one Tauri unknown-bundle runtime marker")
  const payload = Buffer.from(archived)
  payload.write("NSS", offset + marker.length - 3, "ascii")
  return hash(payload)
}

export function fixtureRoot(root) {
  assert.equal(typeof root, "string", "An explicit fixture root is required")
  assert.ok(isAbsolute(root), "Fixture root must be absolute")
  assert.ok(!root.split(/[\\/]/u).includes(".."), "Parent segments are forbidden")
  const name = relative(ROOT, resolve(root))
  assert.match(name, /^update-[0-9a-f]{16}$/u, "Only a new P8 update fixture is accepted")
  return resolve(root)
}

export function inside(fixture, path) {
  assert.ok(isAbsolute(path) && !path.split(/[\\/]/u).includes(".."), "Fixture paths must be absolute without parent segments")
  const suffix = relative(fixture.root, resolve(path))
  assert.ok(suffix && !suffix.startsWith("..") && !isAbsolute(suffix), "Path escapes the fixture")
  return path
}

// Intentionally built from scratch: no tokens, proxies, shell profiles, SSH agent,
// signing key, package-manager config or real HOME survives this boundary.
export function isolatedEnvironment(fixture, { rustBin } = {}) {
  const env = {
    SystemRoot: "C:/Windows", WINDIR: "C:/Windows", SystemDrive: "C:",
    COMSPEC: join(systemDirectory, "cmd.exe"),
    PATH: [rustBin, dirname(process.execPath), systemDirectory, join(systemDirectory, "OpenSSH")].filter(Boolean).join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    HOME: fixture.userHome, USERPROFILE: fixture.userHome,
    APPDATA: fixture.appData, LOCALAPPDATA: fixture.localAppData,
    ProgramData: fixture.programData, TEMP: fixture.tmp, TMP: fixture.tmp,
    CLOUDLINK_HOME: fixture.dataHome, CLOUDLINK_USER_HOME: fixture.userHome,
    CLOUDLINK_WSL_ROOT: fixture.wslRoot, CLOUDLINK_TEST_WSL_DISTROS: "",
    XDG_CONFIG_HOME: join(fixture.userHome, ".config"),
    XDG_CACHE_HOME: join(fixture.userHome, ".cache"),
    XDG_DATA_HOME: join(fixture.userHome, ".local/share"),
    GH_CONFIG_DIR: join(fixture.userHome, ".config/gh"),
    DOCKER_CONFIG: join(fixture.userHome, ".docker"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "NUL",
    NPM_CONFIG_USERCONFIG: join(fixture.root, "control", "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: join(fixture.root, "control", "npmrc-global"),
    NPM_CONFIG_CACHE: join(fixture.root, "build-cache", "npm"),
    PNPM_HOME: join(fixture.root, "build-cache", "pnpm"),
    CARGO_HOME: join(fixture.root, "cargo-home"),
    RUSTUP_HOME: join(fixture.root, "rustup-home"),
    CARGO_TARGET_DIR: join(fixture.root, "target"),
    CARGO_BUILD_JOBS: "1", CARGO_INCREMENTAL: "0",
    PSModuleAnalysisCachePath: "NUL", PSModulePath: "",
    WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: "NUL", GH_PROMPT_DISABLED: "1",
    NO_PROXY: "127.0.0.1,localhost,::1", CI: "true",
  }
  if (rustBin) inside(fixture, rustBin)
  return env
}

export function execute(program, args, { fixture, env = isolatedEnvironment(fixture), cwd = PROJECT, capture = false, input } = {}) {
  const result = spawnSync(program, args, { cwd, env, input, encoding: "utf8", windowsHide: true, shell: false, stdio: capture ? "pipe" : "inherit" })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${program} failed (${result.status}): ${capture ? result.stderr : "see command output"}`)
  return result.stdout?.trim()
}

async function plainFile(fixture, path) {
  inside(fixture, path)
  await assertTestRoot(dirname(path))
  const meta = await lstat(path)
  assert.ok(meta.isFile() && !meta.isSymbolicLink(), "Fixture entry is not a plain file")
  // lstat alone does not recognize every Windows reparse tag.
  const script = "$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'; if (([IO.File]::GetAttributes($env:CLOUDLINK_TEST_PATH) -band 0x400) -ne 0) { throw 'Linked fixture file' }"
  execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    fixture, cwd: systemDirectory, capture: true,
    env: {
      SystemRoot: "C:/Windows", WINDIR: "C:/Windows", PATH: systemDirectory,
      HOME: systemDirectory, USERPROFILE: systemDirectory, APPDATA: systemDirectory,
      LOCALAPPDATA: systemDirectory, ProgramData: systemDirectory, TEMP: systemDirectory, TMP: systemDirectory,
      PSModuleAnalysisCachePath: "NUL", PSModulePath: "", CLOUDLINK_TEST_PATH: path,
    },
  })
  return meta
}

export async function fileBytes(fixture, path, limit = 128 * 1024 * 1024) {
  const meta = await plainFile(fixture, path)
  assert.ok(meta.size <= limit, "Fixture file exceeds its size limit")
  return readFile(path)
}

export async function newFile(fixture, path, content) {
  inside(fixture, path)
  await assertTestRoot(dirname(path))
  await writeFile(path, content, { flag: "wx", mode: 0o600 })
}

export async function replaceOwnedFile(fixture, path, expectedHash, bytes) {
  await owner(fixture, fixture.root, "update-test")
  assert.equal(hash(await fileBytes(fixture, path)), expectedHash, "Owned fixture file changed before replacement")
  await writeFile(path, bytes)
}

export async function owner(fixture, directory, kind) {
  await assertTestRoot(directory)
  const marker = JSON.parse((await fileBytes(fixture, join(directory, ".cloudlink.json"), 64 * 1024)).toString("utf8"))
  assert.equal(marker.managedBy, "cloudlink")
  assert.equal(marker.kind, kind)
  assert.equal(marker.runId, fixture.runId)
  return marker
}

export async function prepareFixture() {
  if (process.platform !== "win32") throw new Error("P8 updater fixtures require Windows")
  await assertTestRoot(ROOT)
  await mkdir(ROOT, { recursive: true })
  const runId = randomBytes(8).toString("hex")
  const fixture = layout(fixtureRoot(join(ROOT, `update-${runId}`)), runId)
  await mkdir(fixture.root) // Exclusive directory creation; never claim a previous run.
  await assertTestRoot(fixture.root, { inspectContents: true })
  await newFile(fixture, join(fixture.root, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "update-test", runId }))
  const dirs = [
    "control", "signing", "artifacts", "build-cache", "frontend", "binaries", "installer-staging", "receipts", "tools", "cargo-home", "rustup-home", "evidence",
    "data", "data/home/.ssh", "data/home/.claude/skills/existing", "data/home/.agents/skills/existing", "data/home/.codex", "data/wsl", "install",
    "os-profile/AppData/Roaming", "os-profile/AppData/Local", "os-profile/ProgramData", "tmp",
  ]
  for (const name of dirs) {
    const directory = join(fixture.root, name)
    await assertTestRoot(directory)
    await mkdir(directory, { recursive: true })
  }
  await newFile(fixture, join(fixture.dataHome, ".cloudlink.json"), '{"managedBy":"cloudlink","kind":"data"}\n')
  await newFile(fixture, join(fixture.installDir, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "update-test-install", runId, productName: fixture.productName, identifier: fixture.identifier, version: null, files: {} }))
  for (const name of ["npmrc", "npmrc-global"]) await newFile(fixture, join(fixture.root, "control", name), "\n")
  await newFile(fixture, join(fixture.userHome, ".claude/settings.json"), '{"theme":"dark"}\n')
  for (const name of [".claude", ".agents"]) await newFile(fixture, join(fixture.userHome, name, "skills/existing/SKILL.md"), "Isolated user skill fixture; preserve these bytes.\n")
  const hosts = join(fixture.userHome, ".ssh/known_hosts").replaceAll("\\", "/")
  await newFile(fixture, join(fixture.userHome, ".ssh/config"), `# Isolated fixture\nHost *\n  UserKnownHostsFile "${hosts}"\n  GlobalKnownHostsFile none\n  IdentityAgent none\n  IdentityFile none\n`)
  await newFile(fixture, join(fixture.userHome, ".ssh/known_hosts"), "")
  await newFile(fixture, join(fixture.root, "control/fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`)
  return fixture
}

export async function loadFixture(root) {
  root = fixtureRoot(root)
  const runId = relative(ROOT, root).slice("update-".length)
  const fixture = layout(root, runId)
  await owner(fixture, root, "update-test")
  const saved = JSON.parse((await fileBytes(fixture, join(root, "control/fixture.json"), 64 * 1024)).toString("utf8"))
  assert.deepEqual(saved, fixture, "Fixture layout or installation identity changed")
  assert.equal(fixture.updatePort, UPDATE_PORT)
  assert.equal(fixture.debugPort, DEBUG_PORT)
  assert.deepEqual(fixture.versions, VERSIONS)
  return fixture
}

export function testConfig(fixture, base, publicKey, version) {
  const windows = base.app.windows.map((window) => ({
    ...window, title: fixture.productName, decorations: true,
    additionalBrowserArgs: `--remote-debugging-port=${DEBUG_PORT} --remote-debugging-address=127.0.0.1`,
    dataDirectory: join(fixture.dataHome, "desktop/webview"),
  }))
  return {
    version, productName: fixture.productName, identifier: fixture.identifier,
    // Relative to the owned application/src-tauri snapshot. A Windows drive path
    // parses as FrontendDist::Url and would open a directory instead of embedding it.
    // Do not run the ordinary prebuild: it rewrites the repository's guard binary and dist.
    build: { beforeBuildCommand: "", frontendDist: "../../frontend" },
    app: { windows },
    bundle: {
      publisher: fixture.publisher, targets: ["nsis"], createUpdaterArtifacts: true, useLocalToolsDir: true,
      externalBin: [join(fixture.root, "binaries", version, "cloudlink-guard")],
      windows: { signCommand: null, certificateThumbprint: null, webviewInstallMode: { type: "skip" }, nsis: { installMode: "currentUser", template: join(fixture.root, `control/installer-${version}.nsi`), installerHooks: null } },
    },
    plugins: { updater: { pubkey: publicKey, endpoints: [`http://127.0.0.1:${UPDATE_PORT}/latest.json`], dangerousInsecureTransportProtocol: true, requireSignedVersion: true, windows: { installMode: "passive", installerArgs: ["/NS"] } } },
  }
}

// Tauri may rewrite Cargo package metadata during a version override. Build in
// an owned source snapshot so neither that nor the ordinary prebuild edits the working tree.
export async function snapshotSources(fixture) {
  const destination = join(fixture.root, "application")
  await assertTestRoot(destination)
  await mkdir(destination)
  await newFile(fixture, join(destination, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "update-test-source", runId: fixture.runId }))
  const digest = createHash("sha256")
  const sources = {}
  async function copy(source, target) {
    const meta = await lstat(source)
    assert.ok(!meta.isSymbolicLink(), "Source snapshot refuses linked entries")
    if (meta.isDirectory()) {
      await mkdir(target, { recursive: true })
      for (const name of (await readdir(source)).sort()) await copy(join(source, name), join(target, name))
    } else {
      assert.ok(meta.isFile(), "Source snapshot refuses special entries")
      const bytes = await readFile(source)
      const name = relative(PROJECT, source).replaceAll("\\", "/")
      sources[name] = hash(bytes)
      digest.update(name).update("\0").update(bytes)
      await writeFile(target, bytes, { flag: "wx" })
    }
  }
  for (const name of ["src", "src-tauri/src", "src-tauri/crates", "src-tauri/icons", "src-tauri/capabilities", "src-tauri/tests"]) {
    const source = join(PROJECT, name)
    // Inspect metadata before descending; include every Windows reparse tag.
    const script = String.raw`
$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'
$pending=[Collections.Generic.Stack[string]]::new(); $cursor=$env:CLOUDLINK_TEST_SOURCE
while ($cursor) { $pending.Push($cursor); $cursor=[IO.Path]::GetDirectoryName($cursor) }
while ($pending.Count) { if (([IO.File]::GetAttributes($pending.Pop()) -band 0x400) -ne 0) { throw 'Linked source ancestor' } }
$pending.Push($env:CLOUDLINK_TEST_SOURCE)
while ($pending.Count) { foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) { $attributes=[IO.File]::GetAttributes($entry); if (($attributes -band 0x400) -ne 0) { throw 'Linked source entry' }; if (($attributes -band 0x10) -ne 0) { $pending.Push($entry) } } }`
    const env = isolatedEnvironment(fixture)
    env.CLOUDLINK_TEST_SOURCE = source
    execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { fixture, env, capture: true })
    await copy(source, join(destination, name))
  }
  for (const name of ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/build.rs", "src-tauri/tauri.conf.json"]) {
    const source = join(PROJECT, name)
    const native = isolatedEnvironment(fixture)
    native.CLOUDLINK_TEST_SOURCE = source
    execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; if (([IO.File]::GetAttributes($env:CLOUDLINK_TEST_SOURCE) -band 0x400) -ne 0) { throw 'Linked source file' }"], { fixture, env: native, capture: true })
    await copy(source, join(destination, name))
  }
  await assertTestRoot(destination, { inspectContents: true })
  return { directory: destination, hash: digest.digest("hex"), sources }
}

export async function unchangedSources(fixture, sources) {
  assert.ok(sources && Object.keys(sources).length > 0 && Object.keys(sources).length <= 8192)
  const paths = Object.keys(sources).map((name) => {
    assert.ok(!isAbsolute(name) && !name.split(/[\\/]/u).includes(".."), "Invalid source fingerprint path")
    return join(PROJECT, name)
  })
  const script = String.raw`
$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'
Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1"
foreach ($path in ([Console]::In.ReadToEnd() | ConvertFrom-Json)) {
  $cursor=$path
  while ($cursor) { if (([IO.File]::GetAttributes($cursor) -band 0x400) -ne 0) { throw 'Linked source fingerprint' }; $cursor=[IO.Path]::GetDirectoryName($cursor) }
}`
  execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { fixture, capture: true, input: JSON.stringify(paths) })
  for (const [name, expected] of Object.entries(sources)) {
    assert.ok(!isAbsolute(name) && !name.split(/[\\/]/u).includes(".."), "Invalid source fingerprint path")
    const path = join(PROJECT, name)
    const meta = await lstat(path)
    assert.ok(meta.isFile() && !meta.isSymbolicLink(), "Source entry is no longer a plain file")
    assert.equal(hash(await readFile(path)), expected, `Working tree changed; rebuild the update fixture: ${name}`)
  }
}

export async function isolatedTrayCopy() {
  // Reuse centralized UI copy, but omit the optional notification body. Windows
  // toast persistence is outside the fixture root and is not part of this update gate.
  const source = await readFile(join(PROJECT, "src/lib/copy.ts"), "utf8")
  const start = source.indexOf("  tray: {")
  const end = source.indexOf("} satisfies TrayCopy", start)
  assert.ok(start >= 0 && end > start, "Centralized tray copy changed")
  const copy = Object.fromEntries([...source.slice(start, end).matchAll(/^\s+([A-Za-z]+): ("(?:\\.|[^"\\])*"),?\s*$/gmu)].map((match) => [match[1], JSON.parse(match[2])]))
  for (const name of ["tooltip", "guardOn", "guardOff", "modesHeader", "readOnly", "standard", "allReadOnly", "prodInStandard", "open", "quit", "notifyTitle", "notifyAllReadOnly"]) assert.equal(typeof copy[name], "string", `Tray copy is not a string: ${name}`)
  delete copy.notifyExecution
  return copy
}

export async function builtArtifacts(fixture) {
  const result = JSON.parse((await fileBytes(fixture, join(fixture.root, "control/built.json"), 1024 * 1024)).toString("utf8"))
  assert.equal(result.managedBy, "cloudlink")
  assert.equal(result.kind, "update-test-artifacts")
  assert.equal(result.runId, fixture.runId)
  assert.deepEqual(result.buildProfile, { profile: "release", applicationOptLevel: 0 })
  await unchangedSources(fixture, result.sources)
  for (const version of VERSIONS) {
    const config = JSON.parse((await fileBytes(fixture, join(fixture.root, "control", `tauri-${version}.json`), 64 * 1024)).toString("utf8"))
    assert.equal(config.productName, fixture.productName)
    assert.equal(config.identifier, fixture.identifier)
    assert.equal(config.bundle.publisher, fixture.publisher)
    assert.equal(config.build.frontendDist, "../../frontend")
    assert.equal(inside(fixture, resolve(fixture.root, "application/src-tauri", config.build.frontendDist)), join(fixture.root, "frontend"))
    assert.equal(config.bundle.windows.nsis.template, join(fixture.root, `control/installer-${version}.nsi`))
    assert.equal(config.plugins.updater.pubkey, result.publicKey)
    assert.deepEqual(config.plugins.updater.endpoints, [`http://127.0.0.1:${UPDATE_PORT}/latest.json`])
    assert.equal(config.plugins.updater.requireSignedVersion, true)
    for (const name of [installerName(fixture, version), `${installerName(fixture, version)}.sig`, "cloudlink.exe", "cloudlink-guard.exe"]) {
      const path = join(fixture.root, "artifacts", version, name)
      assert.equal(hash(await fileBytes(fixture, path)), result.files[`${version}/${name}`], "Built artifact changed outside this fixture")
    }
  }
  for (const name of ["invalid-installer.bin", "invalid-installer.bin.sig"]) assert.equal(hash(await fileBytes(fixture, join(fixture.root, "artifacts", name))), result.files[name])
  return result
}
