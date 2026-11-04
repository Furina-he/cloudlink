// Prepare Tauri's target-suffixed sidecar before `tauri dev/build` or standalone Cargo gates.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const tauri = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri")
function run(program, args, capture = false) {
  const result = spawnSync(program, args, { cwd: tauri, encoding: "utf8", stdio: capture ? "pipe" : "inherit", windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} exited with ${result.status}`)
  return result.stdout?.trim()
}

const target = process.env.TAURI_ENV_TARGET_TRIPLE || run("rustc", ["--print", "host-tuple"], true)
if (!/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error("Invalid Rust target triple")
const binary = `cloudlink-guard${target.includes("windows") ? ".exe" : ""}`
run("cargo", ["build", "--locked", "--jobs", "1", "--release", "--target", target, "-p", "cloudlink-guard"])
const metadata = JSON.parse(run("cargo", ["metadata", "--locked", "--offline", "--no-deps", "--format-version", "1"], true))
const content = await readFile(join(metadata.target_directory, target, "release", binary))
const output = join(tauri, "binaries")
const markerPath = join(output, ".cloudlink.json")
const destination = join(output, `cloudlink-guard-${target}${target.includes("windows") ? ".exe" : ""}`)
// Never follow a symlink/junction in this build output path.
for (let path = output; path !== dirname(path); path = dirname(path)) {
  const meta = await lstat(path).catch((error) => { if (error.code !== "ENOENT") throw error })
  if (meta?.isSymbolicLink()) throw new Error("Sidecar output has a linked ancestor")
}
await mkdir(output, { recursive: true })
const markerMeta = await lstat(markerPath).catch((error) => { if (error.code !== "ENOENT") throw error })
if (markerMeta && (markerMeta.isSymbolicLink() || !markerMeta.isFile())) throw new Error("Sidecar marker is not a regular file")
const previous = await readFile(markerPath, "utf8").catch((error) => { if (error.code !== "ENOENT") throw error })
const marker = previous ? JSON.parse(previous) : { managedBy: "cloudlink", kind: "sidecar-build", files: {} }
if (marker.managedBy !== "cloudlink" || marker.kind !== "sidecar-build") throw new Error("Sidecar output is not owned by CloudLink")
const name = destination.slice(output.length + 1)
const meta = await lstat(destination).catch((error) => { if (error.code !== "ENOENT") throw error })
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
if (meta && (meta.isSymbolicLink() || !meta.isFile() || marker.files[name] !== hash(await readFile(destination)))) {
  throw new Error("Sidecar output was changed outside the build")
}
if (!meta || marker.files[name] !== hash(content)) await writeFile(destination, content)
marker.files[name] = hash(content)
await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`)
console.log(`Prepared ${name}`)
