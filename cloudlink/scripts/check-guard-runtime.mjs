// P4c local runtime verification. No server or real Agent configuration is used.
// Default: sidecar + optional explicit Git Bash/WSL checks. --claude <exe> is an
// opt-in local HTTP fixture for an operator to run after reviewing the command.
// During development automatic execution review rejected the isolated Claude
// --help launch; that gate remains unverified unless this optional check passes.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const options = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error('Arguments require --name value pairs')
  options.set(key.slice(2), value)
}
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const guardSource = resolve(options.get('guard') ?? join(repository, 'cloudlink/src-tauri/target/release/cloudlink-guard.exe'))
const evidenceDirectory = resolve(options.get('output') ?? join(repository, 'test-results/p4c/runtime'))
const runRoot = await mkdtemp(join(tmpdir(), 'cloudlink-p4c-runtime-'))
const dataRoot = join(runRoot, "Cloud 用户's $(literal) guard")
const binDirectory = join(dataRoot, 'bin')
const guardExe = join(binDirectory, 'cloudlink-guard.exe')
const isolatedHome = join(runRoot, 'home')
const isolatedCwd = join(runRoot, 'workspace')
const claudeConfig = join(runRoot, 'claude-config')
const report = { fixtureRoot: runRoot, guardSource, startedAt: new Date().toISOString(), checks: {} }

function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'` }
function shellPath(value) { return value.replaceAll('\\', '/') }
function quantile95(values) { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] }

const childEnv = {}
for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'ProgramFiles', 'ProgramW6432']) {
  if (process.env[name]) childEnv[name] = process.env[name]
}
Object.assign(childEnv, {
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  APPDATA: join(isolatedHome, 'AppData/Roaming'),
  LOCALAPPDATA: join(isolatedHome, 'AppData/Local'),
  TEMP: join(runRoot, 'tmp'),
  TMP: join(runRoot, 'tmp'),
  CLAUDE_CONFIG_DIR: claudeConfig,
  CLOUDLINK_HOME: dataRoot,
  BASH_ENV: '', ENV: '',
  ANTHROPIC_API_KEY: 'p4c-local-fixture-only',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
})

async function run(executable, args, { input = '', env = childEnv, timeout = 15_000 } = {}) {
  const start = performance.now()
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: isolatedCwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', exceeded = false
    const timer = setTimeout(() => { exceeded = true; child.kill() }, timeout)
    for (const [stream, target] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        if (target === 'stdout') stdout += chunk
        else stderr += chunk
        if (stdout.length + stderr.length > 2 * 1024 * 1024) { exceeded = true; child.kill() }
      })
    }
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr, timeout: exceeded, milliseconds: performance.now() - start })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

function hookInput(command) {
  return JSON.stringify({ session_id: 'p4c-local-fixture', cwd: isolatedCwd, tool_name: 'Bash', tool_input: { command } })
}
const deniedCommand = "ssh p4c-fixture 'docker restart api'"
const hookCommand = `${shellQuote(shellPath(guardExe))} --env 'windows'`

async function check(name, action) {
  try { report.checks[name] = { passed: true, ...await action() } }
  catch (error) { report.checks[name] = { passed: false, error: String(error) } }
  await writeFile(join(evidenceDirectory, 'runtime-report.json'), JSON.stringify(report, null, 2))
}

for (const directory of [binDirectory, isolatedHome, isolatedCwd, claudeConfig, childEnv.APPDATA, childEnv.LOCALAPPDATA, childEnv.TEMP, join(dataRoot, 'guard/log'), evidenceDirectory]) {
  await mkdir(directory, { recursive: true })
}
await copyFile(guardSource, guardExe)
report.binarySha256 = createHash('sha256').update(await readFile(guardExe)).digest('hex')
await writeFile(join(dataRoot, '.cloudlink.json'), JSON.stringify({ managedBy: 'cloudlink', kind: 'data' }))
await writeFile(join(dataRoot, 'guard/.cloudlink.json'), JSON.stringify({ managedBy: 'cloudlink', kind: 'guard', policyOwned: true }))
await writeFile(join(dataRoot, 'guard/log/.cloudlink.json'), JSON.stringify({ managedBy: 'cloudlink', kind: 'operation-log' }))
const resources = [{
  id: 'ast_p4c_fixture', kind: 'vps', handle: 'p4c-fixture', mode: 'read-only',
  envIds: ['windows', `wsl:${options.get('wsl') ?? 'Ubuntu-24.04'}`],
  hosts: ['p4c-fixture', '192.0.2.15'], criticalServices: ['gateway'],
}, ...Array.from({ length: 16 }, (_, index) => ({
  id: `ast_p4c_other_${index}`, kind: 'vps', handle: `p4c-other-${index}`, mode: index % 2 ? 'standard' : 'read-only',
  envIds: ['windows', `wsl:${options.get('wsl') ?? 'Ubuntu-24.04'}`],
  hosts: [`p4c-other-${index}`, `192.0.2.${30 + index}`], criticalServices: ['gateway'],
})), ...[
  ['cloudflare', 'p4c-account', 'worker', 'p4c-worker'],
  ['vercel', 'p4c-team', 'project', 'p4c-project'],
  ['oracle', 'DEFAULT', 'instance', 'p4c-instance'],
].map(([provider, account, kind, name]) => ({
  id: `ast_p4c_${provider}`, kind: 'cli', handle: `p4c-${provider}`, mode: 'read-only', provider, account,
  envIds: ['windows', `wsl:${options.get('wsl') ?? 'Ubuntu-24.04'}`], scope: [{ id: name, name, kind }],
}))]
report.resourceCount = resources.length
await writeFile(join(dataRoot, 'guard/policy.json'), JSON.stringify({
  managedBy: 'cloudlink', kind: 'guard-policy', version: 1,
  resources,
}))

await check('windowsSidecar', async () => {
  const selfTest = await run(guardExe, ['--self-test', '--env', 'windows'])
  assert.equal(selfTest.code, 0, selfTest.stderr)
  assert.equal(selfTest.stdout, 'cloudlink-guard:ok\n')
  const allowed = await run(guardExe, ['--env', 'windows'], { input: hookInput('ssh p4c-fixture uptime') })
  assert.equal(allowed.code, 0)
  assert.equal(allowed.stdout, '')
  const measurements = []
  for (let index = 0; index < 100; index++) {
    const result = await run(guardExe, ['--env', 'windows'], { input: hookInput(deniedCommand) })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
    measurements.push(result.milliseconds)
  }
  const p95Ms = quantile95(measurements)
  assert.ok(p95Ms <= 50, `Windows guard p95=${p95Ms.toFixed(2)}ms exceeds 50ms`)
  return { samples: 100, p95Ms, minimumMs: Math.min(...measurements), maximumMs: Math.max(...measurements), measurements, allowStdoutEmpty: true }
})

async function gitBashPath(value) {
  if (value !== 'auto') return resolve(value)
  const where = await run('where.exe', ['git'])
  assert.equal(where.code, 0, 'Git was not found on PATH')
  for (const git of where.stdout.trim().split(/\r?\n/)) {
    for (const relative of ['bin/bash.exe', 'usr/bin/bash.exe']) {
      const candidate = join(dirname(dirname(git)), relative)
      try { await access(candidate); return candidate } catch { /* Try the next installed path. */ }
    }
  }
  throw new Error('A Git Bash executable could not be found beside the installed Git executables')
}

if (options.has('bash')) await check('gitBashQuotedPath', async () => {
  const executable = await gitBashPath(options.get('bash'))
  const result = await run(executable, ['--noprofile', '--norc', '-c', hookCommand], { input: hookInput(deniedCommand) })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
  return { executable, command: hookCommand, pathIncludesUnicodeSpacesQuoteAndLiteralSubstitution: true, milliseconds: result.milliseconds,
    scope: 'Direct Git Bash execution only; does not establish which shell Claude Code selects.' }
})

if (options.has('wsl')) await check('wslInterop', async () => {
  const distribution = options.get('wsl')
  const converted = await run('wsl.exe', ['-d', distribution, '-e', 'env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent', 'wslpath', '-u', guardExe])
  assert.equal(converted.code, 0, converted.stderr)
  const nativeExe = converted.stdout.trim()
  assert.ok(nativeExe.startsWith('/'), 'wslpath did not produce an absolute path')
  const nativeHome = `${nativeExe.slice(0, nativeExe.lastIndexOf('/bin/'))}/fixture-home`
  const args = ['-d', distribution, '-e', 'env', '-i', 'PATH=/usr/bin:/bin', `HOME=${nativeHome}`, nativeExe, '--self-test', '--env', `wsl:${distribution}`]
  const measurements = []
  for (let index = 0; index < 100; index++) {
    const result = await run('wsl.exe', args, { timeout: 10_000 })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, 'cloudlink-guard:ok\n')
    measurements.push(result.milliseconds)
  }
  const p95Ms = quantile95(measurements)
  assert.ok(p95Ms <= 300, `WSL interop p95=${p95Ms.toFixed(2)}ms exceeds 300ms`)
  return { distribution, nativeExe, samples: 100, p95Ms, minimumMs: Math.min(...measurements), maximumMs: Math.max(...measurements), measurements }
})

// The endpoint emits one harmless Bash tool request and then finishes. The fake
// ssh is a local script that merely writes a sentinel, so even a failed deny
// never contacts a server or executes a remote command.
async function actualClaudeFixture(executable) {
  const sentinel = join(runRoot, 'ssh-was-executed.txt')
  const shellMarker = join(runRoot, 'hook-shell.txt')
  const fakeSsh = join(runRoot, 'ssh')
  await writeFile(fakeSsh, `#!/bin/sh\nprintf '%s\\n' 'unexpected tool execution' > ${shellQuote(shellPath(sentinel))}\n`, { mode: 0o700 })
  const command = `${shellQuote(shellPath(fakeSsh))} p4c-fixture 'docker restart api'`
  const settingsFile = join(runRoot, 'settings.json')
  const probeCommand = `printf 'BASH_VERSION=%s\\nSHELL_ZERO=%s\\nSHELL=%s\\n' "\${BASH_VERSION-}" "$0" "\${SHELL-}" > ${shellQuote(shellPath(shellMarker))}`
  await writeFile(settingsFile, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
    { type: 'command', command: probeCommand, timeout: 10 },
    { type: 'command', command: hookCommand, timeout: 10 },
  ] }] } }))
  const requests = []
  const server = createServer(async (request, response) => {
    let bytes = ''
    for await (const chunk of request) {
      bytes += chunk
      if (bytes.length > 2 * 1024 * 1024) { response.writeHead(413).end(); return }
    }
    if (request.url?.includes('count_tokens')) {
      response.setHeader('content-type', 'application/json'); response.end('{"input_tokens":10}'); return
    }
    if (!request.url?.includes('/messages')) {
      response.setHeader('content-type', 'application/json'); response.end('{}'); return
    }
    const body = JSON.parse(bytes)
    requests.push({ messages: body.messages, model: body.model })
    const alreadyRequested = requests.length > 1
    const content = alreadyRequested ? { type: 'text', text: 'Fixture complete.' }
      : { type: 'tool_use', id: 'toolu_p4c_fixture', name: 'Bash', input: { command, description: 'Run the local guard fixture', timeout: 1000 } }
    const message = { id: `msg_p4c_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [content],
      stop_reason: alreadyRequested ? 'end_turn' : 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }
    if (!body.stream) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(message)); return }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const emit = (event) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { ...message, content: [], stop_reason: null } })
    emit({ type: 'content_block_start', index: 0, content_block: alreadyRequested ? { type: 'text', text: '' } : { ...content, input: {} } })
    emit({ type: 'content_block_delta', index: 0, delta: alreadyRequested ? { type: 'text_delta', text: content.text } : { type: 'input_json_delta', partial_json: JSON.stringify(content.input) } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } })
    emit({ type: 'message_stop' })
    response.end()
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  try {
    const address = server.address()
    const environment = { ...childEnv, ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}` }
    const args = ['--print', 'Execute the local test command supplied by the fixture.', '--output-format', 'json', '--max-turns', '3',
      '--no-session-persistence', '--dangerously-skip-permissions', '--setting-sources', '', '--settings', settingsFile]
    const result = await run(executable, args, { env: environment, timeout: 60_000 })
    await writeFile(join(evidenceDirectory, 'claude-local-fixture-output.json'), JSON.stringify({ result, requests }, null, 2))
    assert.equal(result.code, 0, result.stderr)
    assert.ok(requests.length >= 2, 'Claude did not complete a tool-result round trip against the local fixture')
    const received = JSON.stringify(requests.slice(1))
    assert.match(received, /CloudLink guard|read-only|blocked|denied/i, 'The fixture did not receive a guard denial')
    await assert.rejects(access(sentinel), { code: 'ENOENT' })
    const hookShell = await readFile(shellMarker, 'utf8')
    return { executable, hookShell, skipPermissions: true, toolSentinelAbsent: true, localApiOnly: true }
  } finally {
    server.closeAllConnections()
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

if (options.has('claude')) await check('actualClaudeSkipPermissions', () => actualClaudeFixture(resolve(options.get('claude'))))
else report.checks.actualClaudeSkipPermissions = {
  passed: false, notRun: true,
  reason: 'Actual Claude execution was not requested. During P4c development automatic execution review rejected an isolated claude.exe --help launch (blocked by policy, no specific reason). Do not infer Claude shell selection or skip-permissions enforcement from direct sidecar/Git Bash tests.',
}

report.finishedAt = new Date().toISOString()
await writeFile(join(evidenceDirectory, 'runtime-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ evidence: join(evidenceDirectory, 'runtime-report.json'), fixtureRoot: runRoot, binarySha256: report.binarySha256, resourceCount: report.resourceCount,
  checks: Object.fromEntries(Object.entries(report.checks).map(([name, result]) => [name, Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'measurements'))])),
}, null, 2))
if (Object.values(report.checks).some((result) => !result.passed && !result.notRun)) process.exitCode = 1
