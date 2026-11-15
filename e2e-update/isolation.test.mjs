import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { fixtureRoot, hash, inside, isolatedEnvironment, isolatedTrayCopy, nsisPayloadHash, testConfig } from "./isolation.mjs"
import { ROOT, layout } from "../scripts/update-test-config.mjs"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = (name) => readFile(join(project, name), "utf8")

test("NSIS payload hashing applies only Tauri's unique bundle marker patch", () => {
  const archived = Buffer.from("before\0__TAURI_BUNDLE_TYPE_VAR_UNK\0after")
  const expected = Buffer.from("before\0__TAURI_BUNDLE_TYPE_VAR_NSS\0after")
  const before = Buffer.from(archived)
  assert.equal(nsisPayloadHash(archived), hash(expected))
  assert.deepEqual(archived, before)
  assert.notEqual(nsisPayloadHash(Buffer.concat([archived, Buffer.from("changed")])), hash(expected))
  assert.throws(() => nsisPayloadHash(Buffer.from("no marker")))
  assert.throws(() => nsisPayloadHash(Buffer.concat([archived, archived])))
})

test("update acceptance never snapshots real profiles, WSL HOME or registry", async () => {
  const script = await source("scripts/check-update.mjs")
  assert.equal(/node:os|\bhomedir\(|\brealState\(|\bwslSkills\(|\breg\.exe\b|\bGetFolderPath\b/.test(script), false, "real configuration reads remain in the update runner")
  assert.equal(/\.\.\.process\.env/.test(script), false, "the update runner inherits the real environment")
  assert.match(script, /--run/)
})

test("update builds never inherit signing credentials or the user's environment", async () => {
  const script = await source("scripts/build-update-test.mjs")
  assert.equal(/\.\.\.process\.env|\.tauri[\\/]/.test(script), false, "the builder inherits the real environment or release key")
  assert.match(script, /--prepare/)
  assert.match(script, /--build/)
})

test("functional updater packages bound app optimization without changing production profiles", async () => {
  const script = await source("scripts/build-update-test.mjs")
  assert.match(script, /"--config", "profile\.release\.package\.cloudlink\.opt-level=0"/u)
  assert.match(script, /applicationOptLevel: 0/u)
  assert.doesNotMatch(script, /CARGO_PROFILE_RELEASE_OPT_LEVEL|profile\.release\.opt-level=/u)
  const manifest = await source("src-tauri/Cargo.toml")
  assert.doesNotMatch(manifest, /\[profile\.release\.package\.cloudlink\]/u)
})

test("each update test is created beneath the P8 evidence root", async () => {
  const config = await source("scripts/update-test-config.mjs")
  assert.match(config, /"test-results", "p8"/)
  assert.doesNotMatch(config, /export const DATA_HOME\s*=/)
})

test("the isolated NSIS template cannot register, add shortcuts or restart via Explorer", async () => {
  const script = await source("e2e-update/installer.nsi")
  assert.doesNotMatch(script, /\b(?:ReadReg|WriteReg|DeleteReg|CreateShortCut|ShellExec|RunAsUser|RMDir)\w*\b/)
  assert.match(script, /RequestExecutionLevel user/)
  assert.match(script, /installer-runtime\.ps1/)
  assert.match(script, /\/UPDATE/)
})

test("only explicit fresh P8 fixture roots pass the lexical boundary", () => {
  const root = join(ROOT, "update-0123456789abcdef")
  assert.equal(fixtureRoot(root), resolve(root))
  for (const bad of [ROOT, project, "relative", join(ROOT, "update-old"), `${root}/../elsewhere`, join(ROOT, "update-0123456789abcdef", "nested")]) assert.throws(() => fixtureRoot(bad))
  const fixture = layout(root, "0123456789abcdef")
  assert.equal(inside(fixture, join(root, "tmp")), join(root, "tmp"))
  for (const bad of [ROOT, root, project, `${root}/../elsewhere`, "relative"]) assert.throws(() => inside(fixture, bad))
})

test("all profiles, caches and SSH globals are temporary; no inherited credentials", () => {
  const fixture = layout(join(ROOT, "update-0123456789abcdef"), "0123456789abcdef")
  const env = isolatedEnvironment(fixture)
  for (const name of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "TEMP", "TMP", "CLOUDLINK_HOME", "CLOUDLINK_USER_HOME", "CLOUDLINK_WSL_ROOT", "CARGO_HOME", "RUSTUP_HOME", "NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG", "NPM_CONFIG_CACHE", "DOCKER_CONFIG", "GH_CONFIG_DIR"]) assert.equal(inside(fixture, env[name]), env[name], name)
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "SSH_AUTH_SOCK", "SSH_ASKPASS", "TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY", "NODE_OPTIONS", "RUSTC_WRAPPER"]) assert.equal(Object.hasOwn(env, name), false, name)
  assert.equal(env.CLOUDLINK_TEST_WSL_DISTROS, "")
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1")
  assert.equal(env.GIT_CONFIG_GLOBAL, "NUL")
  assert.throws(() => isolatedEnvironment(fixture, { rustBin: project }))
})

test("only test builds opt into loopback HTTP and isolate every output", () => {
  const fixture = layout(join(ROOT, "update-0123456789abcdef"), "0123456789abcdef")
  const config = testConfig(fixture, { app: { windows: [{ title: "CloudLink", width: 1000 }] } }, "temporary-public-key", "0.1.1")
  assert.equal(config.productName, fixture.productName)
  assert.notEqual(config.identifier, "com.cloudlink.desktop")
  assert.equal(config.build.beforeBuildCommand, "")
  assert.equal(config.build.frontendDist, "../../frontend", "Windows drive paths deserialize as URLs, not embedded frontend directories")
  assert.equal(inside(fixture, resolve(fixture.root, "application/src-tauri", config.build.frontendDist)), join(fixture.root, "frontend"))
  assert.throws(() => new URL(config.build.frontendDist), "The frontend path must not parse as an external URL")
  assert.equal(inside(fixture, config.bundle.externalBin[0]), config.bundle.externalBin[0])
  assert.equal(inside(fixture, config.bundle.windows.nsis.template), config.bundle.windows.nsis.template)
  assert.equal(config.bundle.windows.webviewInstallMode.type, "skip")
  assert.equal(config.bundle.useLocalToolsDir, true, "NSIS/WiX caches must stay below the isolated project target, not the real platform cache")
  assert.equal(config.plugins.updater.dangerousInsecureTransportProtocol, true)
  assert.equal(config.plugins.updater.requireSignedVersion, true)
  assert.deepEqual(config.plugins.updater.windows.installerArgs, ["/NS"])
  assert.equal(config.app.windows[0].title, fixture.productName)
  assert.equal(config.app.windows[0].decorations, true)
})

test("SSH fixtures keep their key inside the runner's isolated data roots", async () => {
  const script = await source("scripts/check-update.mjs")
  assert.ok(script.includes('startSshTarget({ root: fixture.dataHome })'), "Evidence siblings are outside the application's allowed SSH roots")
})

test("runner processes start inside an allowed isolated working directory", async () => {
  const script = await source("scripts/check-update.mjs")
  assert.ok(script.includes('spawn(copiedGuard, args, { cwd: fixture.userHome'), "The fixture parent is outside the runner's allowed roots")
})

test("approval samples use a shell wrapper that requires standard-mode approval", async () => {
  const script = await source("scripts/check-update.mjs")
  assert.ok(script.includes("`sh -c 'cloudlink-p8-task ${name}'`"), "An ordinary parseable custom command is allowed in standard mode")
  assert.ok(script.includes('item.command === taskCommand("running")'))
})

test("SSH onboarding matches the submit label including its shortcut hint", async () => {
  const script = await source("scripts/check-update.mjs")
  assert.ok(script.includes('name: /^连接并启用/u'), "The submit button's accessible name also includes Ctrl+S")
})

test("approval UI keeps centralized copy without emitting native system notifications", async () => {
  const copy = await isolatedTrayCopy()
  assert.equal(Object.hasOwn(copy, "notifyExecution"), false)
  assert.equal(typeof copy.notifyTitle, "string")
  assert.equal(typeof copy.guardOn, "string")
})

test("installer updates are owner/hash checked, reparse safe and use a clean direct restart", async () => {
  const script = await source("e2e-update/installer-runtime.ps1")
  for (const rule of [/0x400/u, /Assert-Owner/u, /File-Hash/u, /FileMode\]::CreateNew/u, /UseShellExecute = \$false/u, /EnvironmentVariables\.Clear\(\)/u, /Installer lost its isolated environment/u]) assert.ok(rule.test(script), `Missing installer safety invariant: ${rule}`)
  assert.equal(/\b(?:GetFolderPath|ReadRegStr|WriteRegStr|DeleteRegKey)\b|\[IO\.(?:File|Directory)\]::Delete/u.test(script), false)
  const runner = await source("scripts/check-update.mjs")
  assert.match(runner, /invalid-installer\.bin/u)
  assert.match(runner, /outcome\.code, 75/u)
  assert.match(runner, /executionState === "succeeded"/u)
  assert.equal(/writeFile\([^\n]*runtime\.json|publish_handoff/u.test(runner), false, "The real updater must create handoff state, never the test")
})
