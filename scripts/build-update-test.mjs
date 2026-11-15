// P8-only updater preparation. No command defaults to a build or installation.
// --prepare creates a fresh fixture and disposable signing identity.
// --build --root <fixture> --rust-bin <fixture toolchain bin> builds its signed packages.
import assert from "node:assert/strict"
import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { createServer } from "node:net"

import { assertTestRoot } from "./desktop-ssh-target.mjs"
import { PROJECT, VERSIONS, installerName } from "./update-test-config.mjs"
import { builtArtifacts, execute, fileBytes, hash, inside, isolatedEnvironment, loadFixture, newFile, owner, prepareFixture, replaceOwnedFile, snapshotSources, tauriCli, testConfig, unchangedSources } from "../e2e-update/isolation.mjs"

const usage = "Use --prepare, then --build --root <new fixture> --rust-bin <fixture-owned toolchain bin>. Builds/installers require separate authorization."
const args = process.argv.slice(2)
const mode = args.shift()
if (!["--prepare", "--build"].includes(mode)) throw new Error(usage)
if (process.platform !== "win32") throw new Error("Update fixtures require Windows")
const options = {}
while (args.length) {
  const key = args.shift()
  assert.ok(["--root", "--rust-bin"].includes(key) && args.length && !options[key], usage)
  options[key] = args.shift()
}
const triple = "x86_64-pc-windows-msvc"
const nsisValue = (value) => value.replaceAll("$", "$$").replaceAll('"', '$\\"')

if (mode === "--prepare") {
  assert.deepEqual(options, {}, "Preparation always creates a new root; it never claims or clears an existing one")
  const fixture = await prepareFixture()
  const env = isolatedEnvironment(fixture)
  const key = join(fixture.root, "signing/test.key")
  const password = randomBytes(24).toString("base64url")
  await newFile(fixture, join(fixture.root, "signing/password"), password)
  execute(process.execPath, [tauriCli, "signer", "generate", "-w", key, "-p", password, "--ci"], { fixture, env, capture: true })
  const publicKey = (await fileBytes(fixture, `${key}.pub`, 64 * 1024)).toString("utf8").trim()
  const base = JSON.parse(await readFile(join(PROJECT, "src-tauri/tauri.conf.json"), "utf8"))
  const runtime = join(fixture.root, "control/installer-runtime.ps1")
  await newFile(fixture, runtime, await readFile(join(PROJECT, "e2e-update/installer-runtime.ps1")))
  const template = await readFile(join(PROJECT, "e2e-update/installer.nsi"), "utf8")
  for (const version of VERSIONS) {
    const replacements = {
      __ROOT__: fixture.root, __RUN_ID__: fixture.runId, __INSTALL_DIR__: fixture.installDir,
      __TEMP__: fixture.tmp, __STAGE__: join(fixture.root, "installer-staging", version),
      __RUNTIME_SOURCE__: runtime,
      __GUARD_SOURCE__: join(fixture.root, "binaries", version, `cloudlink-guard-${triple}.exe`),
    }
    let installer = template
    for (const [token, value] of Object.entries(replacements)) installer = installer.replaceAll(token, nsisValue(value))
    await newFile(fixture, join(fixture.root, `control/installer-${version}.nsi`), installer)
    await newFile(fixture, join(fixture.root, `control/tauri-${version}.json`), `${JSON.stringify(testConfig(fixture, base, publicKey, version), null, 2)}\n`)
  }
  // Signed but not executable: the real updater must recover after install/extract fails,
  // without pretending a fake update source or a fabricated handoff ran an installer.
  const invalid = join(fixture.root, "artifacts/invalid-installer.bin")
  await newFile(fixture, invalid, "CloudLink P8 isolated non-executable installation payload\n")
  const signingEnv = { ...env, TAURI_SIGNING_PRIVATE_KEY_PATH: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password }
  execute(process.execPath, [tauriCli, "signer", "sign", "--app-version", VERSIONS[1], invalid], { fixture, env: signingEnv, capture: true })
  console.log(`Prepared isolated fixture: ${fixture.root}`)
  console.log(`No build or installer ran. Disposable key: ${key}; never publish these artifacts.`)
  console.log(`After provisioning a new toolchain beneath this root: node scripts/build-update-test.mjs --build --root "${fixture.root}" --rust-bin "<fixture-owned Rust bin>"`)
} else {
  assert.ok(options["--root"] && options["--rust-bin"], usage)
  const fixture = await loadFixture(options["--root"])
  const rustBin = inside(fixture, options["--rust-bin"])
  await assertTestRoot(rustBin, { inspectContents: true })
  for (const name of ["cargo.exe", "rustc.exe"]) await fileBytes(fixture, join(rustBin, name))
  await owner(fixture, fixture.installDir, "update-test-install")
  // Ports are compiled into the packages; refuse a collision before a long build.
  for (const port of [fixture.updatePort, fixture.debugPort]) {
    const server = createServer()
    await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done) })
    await new Promise((done) => server.close(done))
  }
  const snapshot = await snapshotSources(fixture)
  const env = isolatedEnvironment(fixture, { rustBin })
  env.RUSTC = join(rustBin, "rustc.exe")
  env.RUSTDOC = join(rustBin, "rustdoc.exe")
  // Only a reviewed, copied crates.io cache is used; no registry credentials or network fallback.
  env.CARGO_NET_OFFLINE = "true"
  env.CLOUDLINK_TEST_BUILD_HOME = fixture.dataHome
  env.TAURI_SIGNING_PRIVATE_KEY = join(fixture.root, "signing/test.key")
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (await fileBytes(fixture, join(fixture.root, "signing/password"), 1024)).toString("utf8")
  await fileBytes(fixture, env.TAURI_SIGNING_PRIVATE_KEY, 64 * 1024)
  await assertTestRoot(join(fixture.root, "frontend"), { inspectContents: true })
  execute(process.execPath, [join(PROJECT, "node_modules/vite/bin/vite.js"), "build", "--configLoader", "runner", "--outDir", join(fixture.root, "frontend")], { fixture, env })
  const index = join(fixture.root, "frontend/index.html")
  const html = await fileBytes(fixture, index)
  const title = html.toString("utf8").replace(/<title>[^<]*<\/title>/u, `<title>${fixture.productName}</title>`)
  assert.notEqual(title, html.toString("utf8"), "The fixture needs a unique browser title before attaching to IPC")
  await replaceOwnedFile(fixture, index, hash(html), title)
  await unchangedSources(fixture, snapshot.sources)
  execute(join(rustBin, "cargo.exe"), ["build", "--manifest-path", join(snapshot.directory, "src-tauri/Cargo.toml"), "--locked", "--jobs", "1", "--release", "--target", triple, "-p", "cloudlink-guard"], { fixture, env, cwd: snapshot.directory })
  const guard = await fileBytes(fixture, join(fixture.root, "target", triple, "release/cloudlink-guard.exe"))
  const files = {}
  for (const version of VERSIONS) {
    const binaryDirectory = join(fixture.root, "binaries", version)
    await assertTestRoot(binaryDirectory)
    await mkdir(binaryDirectory)
    // Harmless PE overlay gives same-source test runners distinct hashes, so an
    // occupied old runner actually exercises rename-and-replace during restart.
    const versionedGuard = Buffer.concat([guard, Buffer.from(`\nCloudLink P8 fixture ${fixture.runId} ${version}\n`)])
    await newFile(fixture, join(binaryDirectory, `cloudlink-guard-${triple}.exe`), versionedGuard)
    await newFile(fixture, join(binaryDirectory, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "sidecar-build", runId: fixture.runId, files: { [`cloudlink-guard-${triple}.exe`]: hash(versionedGuard) } }))
    // Functional updater fixtures are not performance/release artifacts. Keep
    // release cfg and dependencies unchanged, but avoid the app's LLVM opt-level 3
    // memory spike on the 16 GiB test machine. The source manifest is untouched.
    execute(process.execPath, [tauriCli, "build", "--ci", "--config", join(fixture.root, `control/tauri-${version}.json`), "--", "--locked", "--jobs", "1", "--config", "profile.release.package.cloudlink.opt-level=0"], { fixture, env, cwd: snapshot.directory })
    const output = join(fixture.root, "artifacts", version)
    await assertTestRoot(output)
    await mkdir(output)
    const name = installerName(fixture, version)
    const sources = {
      [name]: join(fixture.root, "target/release/bundle/nsis", name),
      [`${name}.sig`]: join(fixture.root, "target/release/bundle/nsis", `${name}.sig`),
      "cloudlink.exe": join(fixture.root, "target/release/cloudlink.exe"),
    }
    for (const [name, source] of Object.entries(sources)) {
      const bytes = await fileBytes(fixture, source)
      await newFile(fixture, join(output, name), bytes)
      files[`${version}/${name}`] = hash(bytes)
    }
    await newFile(fixture, join(output, "cloudlink-guard.exe"), versionedGuard)
    files[`${version}/cloudlink-guard.exe`] = hash(versionedGuard)
  }
  await unchangedSources(fixture, snapshot.sources)
  for (const name of ["invalid-installer.bin", "invalid-installer.bin.sig"]) files[name] = hash(await fileBytes(fixture, join(fixture.root, "artifacts", name)))
  const publicKey = (await fileBytes(fixture, join(fixture.root, "signing/test.key.pub"), 64 * 1024)).toString("utf8").trim()
  await newFile(fixture, join(fixture.root, "control/built.json"), `${JSON.stringify({ managedBy: "cloudlink", kind: "update-test-artifacts", runId: fixture.runId, publicKey, files, buildProfile: { profile: "release", applicationOptLevel: 0 }, sourceSnapshotHash: snapshot.hash, sources: snapshot.sources }, null, 2)}\n`)
  await builtArtifacts(fixture)
  console.log(`Built isolated packages only: ${fixture.root}`)
  console.log(`No installer ran. With separate authorization: node scripts/check-update.mjs --run --root "${fixture.root}"`)
}
