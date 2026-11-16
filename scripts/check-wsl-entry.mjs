// Real WSL -> Windows sidecar -> registered WSL SSH/SFTP processes. Uses no GUI,
// real HOME, user Skills or credentials. This proves stopped-state forwarding,
// NOT active coordinator approvals or a model-driven Agent session.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const evidence = await assertTestRoot(resolve(process.argv[2]))
assert.equal(JSON.parse(await readFile(join(evidence, ".cloudlink.json"), "utf8")).kind, "p8-evidence")
const root = await mkdtemp(join(evidence, "wsl-entry-"))
await assertTestRoot(root)
const data = join(root, "data"), home = join(root, "home"), token = randomUUID()
for (const path of [data, join(data, "bin"), join(data, "routes"), home, join(root, "tmp"), join(root, "ProgramData"), join(home, "AppData/Roaming"), join(home, "AppData/Local")]) await mkdir(path, { recursive: true })
await writeFile(join(root, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "p8-wsl-entry", token }), { flag: "wx" })
await writeFile(join(data, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "data" }), { flag: "wx" })
const binary = join(data, "bin/cloudlink-guard.exe")
await copyFile(join(project, "src-tauri/binaries/cloudlink-guard-x86_64-pc-windows-msvc.exe"), binary, constants.COPYFILE_EXCL)
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
await writeFile(join(data, "bin/.cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "guard-bin", binaryHash: hash(await readFile(binary)) }), { flag: "wx" })
const system = process.env.SystemRoot || "C:\\Windows", wsl = join(system, "System32/wsl.exe"), distro = "Ubuntu-24.04"
const env = { SystemRoot: system, WINDIR: system, PATH: [join(system, "System32"), join(system, "System32/OpenSSH")].join(";"),
  HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
  ProgramData: join(root, "ProgramData"), TEMP: join(root, "tmp"), TMP: join(root, "tmp"), CLOUDLINK_HOME: data, CLOUDLINK_USER_HOME: home }
const results = [], report = { root, checks: [], boundary: "Confirmed-stopped forwarding only; no active approvals or real Agent claim" }
let target, nativeHome
const run = (program, args, timeout = 30_000) => new Promise((done, reject) => {
  const child = spawn(program, args, { cwd: home, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  const timer = setTimeout(() => { child.kill(); reject(new Error("WSL entry fixture timed out")) }, timeout)
  child.stdout.on("data", (bytes) => { stdout += bytes; if (stdout.length > 1_048_576) child.kill() })
  child.stderr.on("data", (bytes) => { stderr += bytes; if (stderr.length > 1_048_576) child.kill() })
  child.once("error", (error) => { clearTimeout(timer); reject(error) })
  child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }) })
})
const linux = async (args) => {
  const result = await run(wsl, ["-d", distro, "-e", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", `HOME=${nativeHome || "/tmp"}`, ...args])
  assert.equal(result.code, 0, result.stderr)
  return result
}
const nativePath = async (path) => (await linux(["wslpath", "-a", "-u", path])).stdout.trim()
const winPath = (path) => path.replaceAll("\\", "/")
try {
  target = await startSshTarget({ root })
  nativeHome = (await linux(["mktemp", "-d", "/tmp/cloudlink-p8-wsl-XXXXXXXX"])).stdout.trim()
  assert.match(nativeHome, /^\/tmp\/cloudlink-p8-wsl-[A-Za-z0-9]{8}$/u)
  const marker = join(root, "wsl-home-marker.json")
  await writeFile(marker, JSON.stringify({ managedBy: "cloudlink", kind: "p8-wsl-home", token }), { flag: "wx" })
  await linux(["cp", "--no-clobber", "--", await nativePath(marker), `${nativeHome}/.cloudlink.json`])
  await linux(["cp", "--no-clobber", "--", await nativePath(target.identityFile), `${nativeHome}/identity`])
  await linux(["chmod", "600", "--", `${nativeHome}/identity`])
  assert.equal((await linux(["stat", "-c", "%a", "--", `${nativeHome}/identity`])).stdout.trim(), "600")
  const status = await run(binary, ["status"])
  assert.equal(status.code, 0, status.stderr)
  const runtime = JSON.parse(status.stdout)
  assert.equal(runtime.state, "stopped")
  const alias = /^Host ([A-Za-z0-9-]+)\r?$/mu.exec(await readFile(target.sshConfig, "utf8"))?.[1]
  assert.ok(alias)
  const config = [
    `Host ${alias}`, "  HostName 127.0.0.1", `  Port ${target.port}`, "  User cloudlink",
    `  IdentityFile ${nativeHome}/identity`, `  UserKnownHostsFile "${await nativePath(join(target.directory, "known_hosts"))}"`,
    `  HostKeyAlias ${alias}`, "  IdentityAgent none", "  IdentitiesOnly yes", "  GlobalKnownHostsFile none", "  BatchMode yes",
    "  StrictHostKeyChecking yes", "  ConnectTimeout 2", "  PermitLocalCommand no", "  ClearAllForwardings yes", "  RequestTTY no", "",
  ].join("\n")
  const configPath = join(data, "routes/ssh.conf")
  await writeFile(configPath, config, { flag: "wx" })
  const envId = `wsl:${distro}`, assetId = "ast_wsl_fixture"
  const policy = { id: assetId, kind: "vps", handle: alias, mode: "confirm-changes", production: true, envIds: [envId], hosts: ["127.0.0.1"] }
  const route = { assetId, envId, kind: "vps", enabled: true, production: true, mode: "confirm-changes", distro,
    sshPath: "/usr/bin/ssh", alias, configPath: winPath(configPath), configHash: hash(Buffer.from(config)), policy }
  await writeFile(join(data, "routes/.cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "execution-routes", files: { "ssh.conf": route.configHash } }), { flag: "wx" })
  await writeFile(join(data, "routes/manifest.json"), JSON.stringify({ managedBy: "cloudlink", kind: "execution-routes", version: 1,
    installationId: runtime.installationId, revision: 1, isolated: true, userHome: home, allowedRoots: [home, data], resources: [route] }), { flag: "wx" })
  const entryPath = await nativePath(binary), working = await nativePath(home)
  const entry = async (args) => {
    const result = await run(wsl, ["-d", distro, "--cd", working, "-e", "/usr/bin/env", `HOME=${nativeHome}`,
      `XDG_CONFIG_HOME=${nativeHome}/.config`, `GH_CONFIG_DIR=${nativeHome}/.config/gh`, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", entryPath, ...args])
    results.push({ args, ...result })
    return result
  }
  const query = await entry(["exec", "--env", envId, "--asset", assetId, "--", "uname -s"])
  assert.equal(query.code, 0, query.stderr)
  assert.match(query.stdout, /Linux/u)
  assert.ok(query.stderr.split(/\r?\n/u).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line)).some((item) => item.checked === false && item.state === "succeeded"))
  report.checks.push("WSL invokes the same Windows entry and the registered distro executes real SSH; stopped result is unchecked")
  const input = join(home, "input [literal].txt"), bytes = Buffer.from("CloudLink isolated WSL SFTP\n")
  await writeFile(input, bytes, { flag: "wx" })
  for (const [index, name] of ["remote [literal].txt", "remote {a,b} *?.txt", `remote 'single' "double".txt`, "remote back\\slash.txt"].entries()) {
    const remote = `/home/cloudlink/${name}`, output = join(home, `output [${index}].txt`)
    const put = await entry(["put", "--env", envId, "--asset", assetId, "--", await nativePath(input), remote])
    assert.equal(put.code, 0, put.stderr)
    const get = await entry(["get", "--env", envId, "--asset", assetId, "--", remote, await nativePath(output)])
    assert.equal(get.code, 0, get.stderr)
    assert.deepEqual(await readFile(output), bytes)
    assert.equal((await entry(["put", "--env", envId, "--asset", assetId, "--", await nativePath(input), remote])).code, 125)
    assert.equal((await entry(["get", "--env", envId, "--asset", assetId, "--", remote, await nativePath(output)])).code, 125)
  }
  report.checks.push("WSL SFTP preserves spaces, glob characters, braces, quotes and backslashes, and refuses both overwrite directions")
  assert.equal((await entry(["exec", "--env", "wsl:NotRegistered", "--asset", assetId, "--", "uname -s"])).code, 125)
  assert.equal((await readdir(data)).includes("guard"), false, "Unchecked forwarding must not fabricate an audit log")
  report.passed = true
  console.log("PASS real WSL entry, isolated SSH/SFTP literal paths and honest stopped-state forwarding")
} finally {
  if (nativeHome) {
    const cleanup = String.raw`import json,os,stat,sys
root,token=sys.argv[1:]
assert root.startswith('/tmp/cloudlink-p8-wsl-') and os.path.realpath(root)==root and not stat.S_ISLNK(os.lstat(root).st_mode)
with open(root+'/.cloudlink.json') as f: marker=json.load(f)
assert marker=={'managedBy':'cloudlink','kind':'p8-wsl-home','token':token}
assert set(os.listdir(root))=={'.cloudlink.json','identity'}
for name in ('.cloudlink.json','identity'):
 p=root+'/'+name
 assert stat.S_ISREG(os.lstat(p).st_mode) and not stat.S_ISLNK(os.lstat(p).st_mode)
for name in ('identity','.cloudlink.json'): os.unlink(root+'/'+name)
os.rmdir(root)
`
    await linux(["python3", "-I", "-c", cleanup, nativeHome, token])
    report.wslHomeRemoved = true
  }
  await target?.dispose()
  await writeFile(join(root, "result.json"), `${JSON.stringify({ ...report, results }, null, 2)}\n`, { flag: "wx" })
  console.log(`WSL evidence: ${root}`)
}
