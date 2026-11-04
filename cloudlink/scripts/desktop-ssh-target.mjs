// Real SSH fixture for the Windows desktop suite. Its generated files stay in
// the caller's test-results root; Docker only receives its own labelled target.
import { spawn } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const resultsRoot = join(workspace, "test-results")
const source = join(workspace, "cloudlink/e2e-desktop/ssh-target")
const systemRoot = process.env.SystemRoot || "C:\\Windows"
const systemDirectory = join(systemRoot, "System32")
const wslExe = join(systemDirectory, "wsl.exe")
const sshExe = join(systemDirectory, "OpenSSH/ssh.exe")
const keygenExe = join(systemDirectory, "OpenSSH/ssh-keygen.exe")
const powershellExe = join(systemDirectory, "WindowsPowerShell/v1.0/powershell.exe")

function isolatedEnvironment(root) {
  const home = join(root, "native-home")
  return {
    SystemRoot: systemRoot, WINDIR: systemRoot,
    PATH: [systemDirectory, join(systemDirectory, "OpenSSH")].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    HOME: home, USERPROFILE: home,
    APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
    // Windows OpenSSH exits silently with 255 if ProgramData is absent.
    // Point it to fixture storage so its global config cannot reach real files.
    ProgramData: join(root, "ProgramData"),
    TEMP: join(root, "tmp"), TMP: join(root, "tmp"),
  }
}

function execute(program, args, { cwd, env, input = "", timeout = 30_000, signal } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, args, { cwd, env, signal, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = "", stderr = "", failure
    const timer = timeout > 0 ? setTimeout(() => { failure = new Error("Process timed out"); child.kill() }, timeout) : undefined
    for (const [stream, output] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
      stream.setEncoding("utf8")
      stream.on("data", (chunk) => {
        if (output === "stdout") stdout += chunk
        else stderr += chunk
        if (stdout.length + stderr.length > 8 * 1024 * 1024) {
          failure = new Error("Process output exceeded the fixture limit")
          child.kill()
        }
      })
    }
    child.on("error", (error) => { clearTimeout(timer); reject(error) })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr, failure: failure?.message })
    })
    child.stdin.on("error", () => {})
    child.stdin.end(input)
  })
}

export async function assertTestRoot(root, { inspectContents = false } = {}) {
  if (process.platform !== "win32") throw new Error("The desktop SSH fixture requires Windows and WSL")
  if (typeof root !== "string" || !isAbsolute(root)) throw new Error("SSH fixture root must be absolute")
  const target = resolve(root)
  const suffix = relative(resultsRoot, target)
  if (!suffix || suffix.startsWith("..") || isAbsolute(suffix)) throw new Error("SSH fixture root must be below workspace test-results")
  // These characters would be interpreted by OpenSSH inside quoted config paths.
  if (/[\x00-\x1f"%$]/u.test(target)) throw new Error("SSH fixture root contains an unsupported SSH config path character")
  // Inspect root-to-leaf before traversing any descendant. GetAttributes also
  // catches Windows reparse-point types that lstat does not report as symlinks.
  // The program is fixed; paths are supplied as data, never interpolated code.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$inspectionPath = [IO.Path]::GetFullPath($env:CLOUDLINK_TEST_PATH)
$ancestors = [Collections.Generic.Stack[string]]::new()
while ($inspectionPath) {
  $ancestors.Push($inspectionPath)
  $inspectionPath = [IO.Path]::GetDirectoryName($inspectionPath)
}
while ($ancestors.Count) {
  try { $inspectionAttributes = [IO.File]::GetAttributes($ancestors.Pop()) }
  catch {
    $inspectionFailure = $_.Exception
    while ($inspectionFailure.InnerException) { $inspectionFailure = $inspectionFailure.InnerException }
    if ($inspectionFailure -is [IO.FileNotFoundException] -or $inspectionFailure -is [IO.DirectoryNotFoundException]) { break }
    throw
  }
  if (($inspectionAttributes -band 0x400) -ne 0) { throw 'Test root contains a reparse point' }
  if (($inspectionAttributes -band 0x10) -eq 0) { throw 'Test root has a non-directory ancestor' }
}
if ($env:CLOUDLINK_TEST_INSPECT_CONTENTS -eq '1') {
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($env:CLOUDLINK_TEST_PATH)
  while ($pending.Count) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
      $entryAttributes = [IO.File]::GetAttributes($entry)
      if (($entryAttributes -band 0x400) -ne 0) { throw 'Test root contains a linked entry' }
      if (($entryAttributes -band 0x10) -ne 0) { $pending.Push($entry) }
    }
  }
}`
  const checked = await execute(powershellExe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    // PowerShell can initialize profile/cache directories even with NoProfile.
    // Use only existing system paths and disable module caching; checking a
    // candidate must never create directories beneath that untrusted path.
    cwd: systemDirectory, env: {
      SystemRoot: systemRoot, WINDIR: systemRoot, PATH: systemDirectory,
      HOME: systemDirectory, USERPROFILE: systemDirectory,
      APPDATA: systemDirectory, LOCALAPPDATA: systemDirectory,
      ProgramData: systemDirectory, TEMP: systemDirectory, TMP: systemDirectory,
      PSModuleAnalysisCachePath: "NUL",
      CLOUDLINK_TEST_PATH: target, CLOUDLINK_TEST_INSPECT_CONTENTS: inspectContents ? "1" : "0",
    },
  })
  if (checked.code !== 0 || checked.failure) throw new Error(`SSH fixture root check failed: ${checked.failure || checked.stderr.trim()}`)
  const ancestors = []
  for (let path = target; ; path = dirname(path)) {
    ancestors.unshift(path)
    if (path === dirname(path)) break
  }
  for (const path of ancestors) {
    const info = await lstat(path).catch((error) => { if (error.code !== "ENOENT") throw error })
    if (!info) break
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("SSH fixture root has a linked or non-directory ancestor")
  }
  if (inspectContents) {
    const pending = [target]
    while (pending.length) {
      const directory = pending.pop()
      for (const name of await readdir(directory)) {
        const path = join(directory, name)
        const info = await lstat(path)
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error("SSH fixture root contains a linked or special entry")
        if (info.isDirectory()) pending.push(path)
      }
    }
  }
  return target
}

export async function startSshTarget({ root, distro = "Ubuntu-24.04" }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(distro)) throw new Error("Invalid WSL distribution name")
  root = await assertTestRoot(root)
  await mkdir(root, { recursive: true })
  await assertTestRoot(root)
  const directory = await mkdtemp(join(root, "ssh-target-"))
  await assertTestRoot(directory)
  const runId = randomUUID()
  const containerName = `cloudlink-test-ssh-${runId}`
  const labelKey = "com.cloudlink.test.run"
  const fixtureKey = "com.cloudlink.test.fixture"
  const fixtureName = "desktop-ssh-target"
  const password = `CloudLink-test-${randomBytes(24).toString("base64url")}`
  const env = isolatedEnvironment(directory)
  const identityFile = join(directory, "identity_ed25519")
  let sshConfig
  const sshAlias = `cloudlink-target-${runId}`
  const context = join(directory, "context")
  let containerId, port, keeper, keeperAbort, commandIndex = 0, configVersion = 0, disposed = false
  for (const path of [context, join(directory, "logs"), env.HOME, env.APPDATA, env.LOCALAPPDATA, env.ProgramData, env.TEMP, join(directory, "docker-config")]) {
    await mkdir(path, { recursive: true })
  }
  await writeFile(join(directory, ".cloudlink.json"), `${JSON.stringify({ managedBy: "cloudlink", kind: "desktop-ssh-target", runId })}\n`, { flag: "wx" })

  async function run(program, args, options = {}) {
    const result = await execute(program, args, { cwd: directory, env, ...options })
    const log = join(directory, "logs", `${String(++commandIndex).padStart(3, "0")}.log`)
    await writeFile(log, `${result.stdout}\n${result.stderr}`, { flag: "wx" })
    if (!options.allowFailure && (result.code !== 0 || result.failure)) {
      throw new Error(`SSH fixture process failed (${result.failure || result.code}); see ${log}: ${result.stderr.trim().slice(-1800)}`)
    }
    return result
  }
  const wslPrefix = ["-d", distro, "--exec", "env", "-i", "PATH=/usr/sbin:/usr/bin:/bin"]
  const nativePath = async (path) => (await run(wslExe, [...wslPrefix, "wslpath", "-a", "-u", path])).stdout.trim()
  const wslDirectory = await nativePath(directory)
  if (!wslDirectory.startsWith("/")) throw new Error("WSL did not return an absolute test directory")
  const docker = (args, options) => run(wslExe, [
    ...wslPrefix, `HOME=${wslDirectory}/native-home`, `DOCKER_CONFIG=${wslDirectory}/docker-config`,
    "docker", "--config", `${wslDirectory}/docker-config`, ...args,
  ], options)

  async function ownedContainer({ optional = false } = {}) {
    const result = await docker(["container", "inspect", containerId || containerName], { allowFailure: optional })
    if (optional && result.code !== 0 && /No such (object|container)/iu.test(result.stderr)) return undefined
    if (result.code !== 0 || result.failure) throw new Error("Could not inspect SSH fixture ownership")
    const info = JSON.parse(result.stdout)[0]
    if (!/^[0-9a-f]{64}$/u.test(info?.Id) || info.Config?.Labels?.[labelKey] !== runId || info.Config?.Labels?.[fixtureKey] !== fixtureName) {
      throw new Error("Refusing to control a container without matching SSH fixture labels")
    }
    if (containerId && info.Id !== containerId) throw new Error("SSH fixture container identity changed")
    containerId = info.Id
    return info
  }
  async function dispose() {
    if (disposed) return
    try {
      await assertTestRoot(directory, { inspectContents: true })
      const marker = JSON.parse(await readFile(join(directory, ".cloudlink.json"), "utf8"))
      if (marker.managedBy !== "cloudlink" || marker.kind !== fixtureName || marker.runId !== runId) throw new Error("SSH fixture file ownership changed")
      const info = await ownedContainer({ optional: true })
      if (info) {
        await docker(["logs", containerId], { allowFailure: true })
        await docker(["container", "rm", "--force", containerId])
      }
      disposed = true
    } finally {
      keeperAbort?.abort()
      await keeper
    }
  }
  function keepWslAlive() {
    // systemd services alone do not keep a WSL distribution running. A native
    // foreground Docker waiter keeps this target available while the UI runs.
    keeperAbort = new AbortController()
    keeper = docker(["container", "wait", containerId], { timeout: 0, signal: keeperAbort.signal, allowFailure: true }).catch(() => {})
  }
  async function configureClient() {
    const info = await ownedContainer()
    const mappings = info.NetworkSettings.Ports["2222/tcp"]
    if (mappings?.length !== 1 || mappings[0].HostIp !== "127.0.0.1") throw new Error("SSH fixture must publish only on IPv4 loopback")
    port = Number(mappings[0].HostPort)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Docker returned an invalid SSH port")
    // Docker assigns another ephemeral port after stop/start. Retain each
    // config as evidence rather than overwriting a previous fixture file.
    sshConfig = join(directory, `ssh_config-${++configVersion}`)
    const configPath = (path) => path.replaceAll("\\", "/")
    await writeFile(sshConfig, [
      `Host ${sshAlias}`, "  HostName 127.0.0.1", `  Port ${port}`, "  User cloudlink",
      `  IdentityFile "${configPath(identityFile)}"`, `  UserKnownHostsFile "${configPath(join(directory, "known_hosts"))}"`,
      `  HostKeyAlias ${sshAlias}`, "  GlobalKnownHostsFile none", "  IdentityAgent none", "  IdentitiesOnly yes",
      "  BatchMode yes", "  StrictHostKeyChecking yes", "  ConnectTimeout 2", "  ConnectionAttempts 1",
      "  PermitLocalCommand no", "  ClearAllForwardings yes", "  RequestTTY no", "  UpdateHostKeys no", "",
    ].join("\n"), { flag: "wx" })
  }
  async function ssh(command, { executable = sshExe, allowFailure = false } = {}) {
    return run(executable, ["-F", sshConfig, "-T", "--", sshAlias, command], { allowFailure, timeout: 15_000 })
  }
  async function waitForSsh() {
    const deadline = Date.now() + 30_000
    let last
    do {
      last = await ssh("printf 'cloudlink-ssh-ready\\n'", { allowFailure: true })
      if (last.code === 0 && last.stdout.trim() === "cloudlink-ssh-ready") return
      await delay(300)
    } while (Date.now() < deadline)
    throw new Error(`SSH target did not become reachable from Windows: ${last?.stderr.trim()}`)
  }

  try {
    const contentHash = createHash("sha256")
    for (const name of ["Dockerfile", "entrypoint.sh", "configure.sh"]) {
      const content = await readFile(join(source, name))
      contentHash.update(name).update(content)
      await writeFile(join(context, name), content, { flag: "wx" })
    }
    const imageTag = `cloudlink-desktop-ssh:${contentHash.digest("hex").slice(0, 16)}`
    await run(keygenExe, ["-q", "-t", "ed25519", "-N", "", "-C", `cloudlink-test-${runId}`, "-f", identityFile])
    const publicKey = (await readFile(`${identityFile}.pub`, "utf8")).trim()
    await docker(["version", "--format", "{{.Server.Version}}"])
    await docker([
      "build", "--label", `${fixtureKey}=${fixtureName}`, "--tag", imageTag,
      "--iidfile", `${wslDirectory}/image-id`, `${wslDirectory}/context`,
    ], { timeout: 240_000 })
    const imageId = (await readFile(join(directory, "image-id"), "utf8")).trim()
    if (!/^sha256:[0-9a-f]{64}$/u.test(imageId)) throw new Error("Docker returned an invalid image ID")
    const created = await docker([
      "container", "create", "--name", containerName,
      "--label", `${labelKey}=${runId}`, "--label", `${fixtureKey}=${fixtureName}`,
      "--publish", "127.0.0.1::2222", "--restart", "no", "--memory", "192m", "--pids-limit", "96",
      "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID",
      "--cap-add", "SYS_CHROOT", "--cap-add", "KILL", "--cap-add", "DAC_OVERRIDE",
      "--security-opt", "no-new-privileges", imageId,
    ])
    containerId = created.stdout.trim()
    await ownedContainer()
    await docker(["container", "start", containerId])
    keepWslAlive()
    await docker(["exec", "--interactive", containerId, "/usr/local/bin/configure.sh"], { input: `${password}\n${publicKey}\n` })
    const hostKey = (await docker(["exec", containerId, "cat", "/etc/ssh/ssh_host_ed25519_key.pub"])).stdout.trim()
    if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/u.test(hostKey)) throw new Error("Invalid fixture host public key")
    await writeFile(join(directory, "host_key.pub"), `${hostKey}\n`, { flag: "wx" })
    await writeFile(join(directory, "known_hosts"), `${sshAlias} ${hostKey}\n`, { flag: "wx" })
    const fingerprint = (await run(keygenExe, ["-l", "-f", join(directory, "host_key.pub")])).stdout.trim().split(/\s+/u)[1]
    await configureClient()
    await waitForSsh()
    return {
      host: "127.0.0.1", get port() { return port }, user: "cloudlink", password, identityFile, directory, containerId,
      hostKeyFingerprint: fingerprint, get sshConfig() { return sshConfig }, ssh, dispose,
      async exec(args, { user = "cloudlink" } = {}) {
        await ownedContainer()
        return docker(["exec", "--user", user, containerId, ...args])
      },
      async stop() {
        await ownedContainer()
        await docker(["container", "stop", "--time", "5", containerId])
        await keeper
      },
      async restart() {
        await ownedContainer()
        await docker(["container", "start", containerId])
        keepWslAlive()
        await configureClient()
        await waitForSsh()
        return { host: "127.0.0.1", port }
      },
    }
  } catch (error) {
    try { await dispose() } catch (cleanupError) { throw new AggregateError([error, cleanupError], "SSH target setup and cleanup failed") }
    throw error
  }
}
