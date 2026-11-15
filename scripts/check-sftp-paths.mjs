// Regression for the actual Win32 SFTP tokenizer/glob implementation, not a shell.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { assertTestRoot, startSshTarget } from "./desktop-ssh-target.mjs"

const evidence = await assertTestRoot(resolve(process.argv[2]))
assert.equal(JSON.parse(await readFile(join(evidence, ".cloudlink.json"), "utf8")).kind, "p8-evidence")
const root = await mkdtemp(join(evidence, "sftp-paths-"))
await assertTestRoot(root)
await writeFile(join(root, ".cloudlink.json"), JSON.stringify({ managedBy: "cloudlink", kind: "p8-sftp-paths" }), { flag: "wx" })
const local = join(root, "home [paths]")
const system = process.env.SystemRoot || "C:\\Windows"
const env = { SystemRoot: system, WINDIR: system, PATH: join(system, "System32"), HOME: local, USERPROFILE: local,
  APPDATA: join(local, "AppData/Roaming"), LOCALAPPDATA: join(local, "AppData/Local"),
  ProgramData: join(root, "ProgramData"), TEMP: join(root, "tmp"), TMP: join(root, "tmp") }
for (const path of [local, env.APPDATA, env.LOCALAPPDATA, env.ProgramData, env.TEMP]) await mkdir(path, { recursive: true })
// makeargv itself escapes quoted glob characters; adjacent quotes avoid Win32's
// convertToForwardslash pass rewriting backslash-escaped quote characters.
const literal = (path) => '"' + path.replaceAll("\\", "/").replaceAll('"', "\"'\"'\"") + '"'
const results = []
let target
try {
  target = await startSshTarget({ root })
  const alias = /^Host ([A-Za-z0-9-]+)\r?$/mu.exec(await readFile(target.sshConfig, "utf8"))?.[1]
  assert.ok(alias)
  const sftp = (batch) => new Promise((done, reject) => {
    const child = spawn(join(system, "System32/OpenSSH/sftp.exe"), ["-F", target.sshConfig, "-b", "-", "--", alias], {
      cwd: local, env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = "", stderr = ""
    const timer = setTimeout(() => { child.kill(); reject(new Error("SFTP fixture timed out")) }, 15_000)
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 1_048_576) child.kill() })
    child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 1_048_576) child.kill() })
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("close", (code) => { clearTimeout(timer); results.push({ batch, code, stdout, stderr }); done({ code, stdout, stderr }) })
    child.stdin.on("error", () => {})
    child.stdin.end(`${batch}\nquit\n`)
  })
  const input = join(local, "input [literal].txt")
  const bytes = Buffer.from("CloudLink isolated SFTP path regression\n")
  await writeFile(input, bytes, { flag: "wx" })
  for (const [index, name] of ["remote [literal].txt", "remote *?.txt", 'remote "quoted".txt', 'remote \'single\' "double".txt'].entries()) {
    const remote = `/home/cloudlink/${name}`
    const put = await sftp(`put ${literal(input)} ${literal(remote)}`)
    assert.equal(put.code, 0, put.stderr)
    await target.exec(["stat", "--", remote])
    const stat = await sftp(`ls -l ${literal(remote)}`)
    assert.equal(stat.code, 0, stat.stderr)
    const output = join(local, `output [${index}].txt`)
    const get = await sftp(`get ${literal(remote)} ${literal(output)}`)
    assert.equal(get.code, 0, get.stderr)
    assert.deepEqual(await readFile(output), bytes)
  }
  const braces = "/home/cloudlink/remote {a,b}.txt"
  assert.equal((await sftp(`put ${literal(input)} ${literal(braces)}`)).code, 0)
  await target.exec(["stat", "--", braces])
  assert.notEqual((await sftp(`ls -l ${literal(braces)}`)).code, 0, "Win32 SFTP brace expansion cannot be disabled by quoting")
  const oldEscape = await sftp('ls -l "/home/cloudlink/remote \\[literal\\].txt"')
  assert.notEqual(oldEscape.code, 0, "Explicit glob backslashes must reproduce Win32 path rewriting")
  console.log("PASS Win32 local literal paths, remote literal destinations, and exact remote glob sources")
} finally {
  await writeFile(join(root, "result.json"), `${JSON.stringify({ root, results }, null, 2)}\n`, { flag: "wx" })
  await target?.dispose()
  console.log(`SFTP evidence: ${root}`)
}
