// Run with `node --test metadata.test.cjs`. Every CLI call is answered in memory; this
// harness never discovers binaries, reads login state or opens a socket. The exceptions
// are the Windows discovery test, which looks up a stand-in command file in a temporary
// directory, and the PowerShell tests, which run an injected fake command.
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const source = readFileSync(join(__dirname, "metadata.js"), "utf8");
const account = "11111111111111111111111111111111";
const zoneId = "22222222222222222222222222222222";
const otherZoneId = "33333333333333333333333333333333";
const privateMarker = "fake-credential-must-stay-private";

async function bridge(operation, provider, replies) {
  const calls = [];
  let output = "";
  let complete;
  const completed = new Promise(resolve => { complete = resolve; });
  const context = {
    Buffer, URL, AbortSignal,
    process: {
      argv: ["node", operation, provider, "/isolated/cli", provider === "vercel" ? "team_current" : account],
      env: { CLOUDFLARE_ACCOUNT_ID: "stale", CF_SEND_TELEMETRY: "true" },
      stdout: { write(text) { output += text; complete(); } },
    },
    require(name) {
      assert.equal(name, "node:child_process");
      return { spawnSync(binary, args, options) {
        assert.equal(binary, "/isolated/cli");
        assert.equal(options.shell, false);
        assert.equal(options.env.CF_SEND_TELEMETRY, "false");
        assert.equal(options.env.DO_NOT_TRACK, "1");
        assert.equal(options.env.NO_COLOR, "1");
        assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, provider === "vercel" ? "team_current" : account);
        calls.push([...args]);
        const reply = replies(args, calls.length);
        return { status: 0, stdout: JSON.stringify(reply), stderr: privateMarker, ...reply?.nativeResult };
      } };
    },
  };
  vm.runInNewContext(source, context, { filename: "metadata.js", timeout: 1000 });
  await completed;
  assert.equal(output.includes(privateMarker), false);
  const metadata = JSON.parse(output.split("__CLOUDLINK_CLI_METADATA__").at(-1).trim());
  return { metadata, calls };
}

const twoZones = [zoneId, otherZoneId].map((id, i) => ({ id, name: "zone-" + i + ".example", account: { id: account } }));
const unlinkedZones = [
  { id: "zone:" + zoneId, kind: "zone", name: "zone-0.example", addresses: [] },
  { id: "zone:" + otherZoneId, kind: "zone", name: "zone-1.example", addresses: [] },
];
const failed = (message) => ({ nativeResult: { status: 1, stdout: "", stderr: message } });

test("Vercel whoami team IDs survive projection and teams pagination deduplicates personal scopes", async () => {
  const result = await bridge("identity", "vercel", args => {
    if (args[0] === "whoami") return {
      username: "my-user", token: privateMarker,
      team: { id: "team_current", slug: "production", name: "Production", token: privateMarker },
    };
    assert.deepEqual([...args].slice(0, 5), ["teams", "list", "--format=json", "--limit", "100"]);
    return args.includes("--next")
      ? { teams: [{ id: "user_stable", slug: "my-user" }, { id: "team_other", slug: "other" }], pagination: { next: null } }
      : { teams: [{ id: "user_stable", slug: "my-user" }, { id: "team_current", slug: "production" }], pagination: { next: 123 } };
  });
  assert.equal(result.metadata.team.id, "team_current");
  assert.deepEqual(result.metadata.teams.map(team => team.id), ["user_stable", "team_current", "team_other"]);
  assert.deepEqual(result.calls.at(-1).slice(-2), ["--next", "123"]);
});

test("Vercel teams list supplies only team IDs for Northstar accounts", async () => {
  const result = await bridge("identity", "vercel", args => args[0] === "whoami"
    ? { username: "northstar-user", team: { id: "team_current", slug: "current" } }
    : { teams: [{ id: "team_current", slug: "current" }], pagination: { next: null } });
  assert.deepEqual(result.metadata.teams.map(team => team.id), ["team_current"]);
});

test("nonzero unauthenticated JSON is projected without querying teams", async () => {
  const result = await bridge("identity", "vercel", () => ({
    nativeResult: { status: 1, stdout: JSON.stringify({ authenticated: false, expired: true, token: privateMarker }) },
  }));
  assert.deepEqual(result.metadata, { authenticated: false, expired: true });
  assert.equal(result.calls.length, 1);
});

test("Vercel pagination cycles fail without returning a partial catalog", async () => {
  const result = await bridge("scope", "vercel", (_args, count) => ({
    projects: [{ id: "prj_" + count, name: "Project" }], pagination: { next: count === 2 ? 456 : 123 },
  }));
  assert.deepEqual(result.metadata, { error: "cli-scope-failed" });
  assert.equal(result.calls.length, 3);
  assert.deepEqual(result.calls[0].slice(0, 4), ["project", "list", "--scope", "team_current"]);
});

test("a malformed ID cannot carry nested credentials into the output envelope", async () => {
  const result = await bridge("scope", "vercel", () => ({
    projects: [{ id: { secret: privateMarker }, name: "Project" }], pagination: { next: null },
  }));
  assert.deepEqual(result.metadata, { error: "cli-scope-failed" });
});

test("Cloudflare Workers paginate at 100 per page and keep their names", async () => {
  const result = await bridge("scope", "cloudflare", args => {
    if (args[0] !== "workers") return [];
    assert.equal(args[args.indexOf("--per-page") + 1], "100");
    const page = Number(args[args.indexOf("--page") + 1]);
    return page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ id: "script-" + i, name: "worker-" + i }))
      : [{ id: "script-100", name: "last" }];
  });
  assert.equal(result.metadata.items.length, 101);
  assert.deepEqual(result.metadata.items[0], { id: "worker:script-0", kind: "worker", name: "worker-0" });
  assert.equal(result.calls.filter(args => args[0] === "workers").length, 2);
});

test("Cloudflare Pages paginate at 100 per page", async () => {
  const result = await bridge("scope", "cloudflare", args => {
    if (args[0] !== "pages") return [];
    assert.equal(args[args.indexOf("--per-page") + 1], "100");
    const page = Number(args[args.indexOf("--page") + 1]);
    return page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ name: "site-" + i }))
      : [{ name: "site-100" }];
  });
  assert.equal(result.metadata.items.length, 101);
  assert.equal(result.metadata.items[0].id, "pages:site-0");
  assert.equal(result.calls.filter(args => args[0] === "pages").length, 2);
});

test("Cloudflare DNS records the login may not read leave zones unlinked without failing the scope", async () => {
  const result = await bridge("scope", "cloudflare", args => {
    if (args[0] === "zones") return twoZones;
    if (args[0] === "dns") return failed("403 Forbidden");
    return args[0] === "workers" ? [{ id: "api", name: "api" }] : [];
  });
  assert.deepEqual(result.metadata.items, [...unlinkedZones, { id: "worker:api", kind: "worker", name: "api" }]);
  // One refusal settles it for the whole refresh.
  assert.equal(result.calls.filter(args => args[0] === "dns").length, 1);
});

test("a DNS failure other than a refusal still fails the scope", async () => {
  const result = await bridge("scope", "cloudflare", args => {
    if (args[0] === "zones") return twoZones;
    return args[0] === "dns" ? failed("connection reset by peer") : [];
  });
  assert.deepEqual(result.metadata, { error: "cli-command-unsupported" });
});

test("empty Workers and Pages lists are empty scopes", async () => {
  const result = await bridge("scope", "cloudflare", () => []);
  assert.deepEqual(result.metadata, { items: [] });
});

test("a refused Workers list fails the scope and does not query Pages", async () => {
  const result = await bridge("scope", "cloudflare", args => args[0] === "workers"
    ? failed("403 Forbidden") : []);
  assert.deepEqual(result.metadata, { error: "cli-scope-permission" });
  assert.equal(result.calls.some(args => args[0] === "pages"), false);
});

test("the bound account reaches zones list as an argument and every cf call as the environment", async () => {
  const result = await bridge("scope", "cloudflare", () => []);
  assert.deepEqual(result.metadata, { items: [] });
  assert.deepEqual(result.calls[0], ["zones", "list", "--account-id", account, "--page", "1", "--per-page", "100"]);
});

test("Cloudflare DNS addresses remain projected public metadata within the bound account", async () => {
  const result = await bridge("scope", "cloudflare", args => {
    if (args[0] === "zones") return [{ id: zoneId, name: "example.com", account: { id: account }, secrets: privateMarker }];
    if (args[0] === "dns") return [{ content: args[args.indexOf("--type") + 1] === "A" ? "203.0.113.10" : "2001:db8::1", secrets: privateMarker }];
    return [];
  });
  assert.deepEqual(result.metadata.items, [{ id: "zone:" + zoneId, kind: "zone", name: "example.com", addresses: ["203.0.113.10", "2001:db8::1"] }]);
});

test("more than 500 catalog items fail with a fixed ID", async () => {
  const result = await bridge("scope", "cloudflare", args => {
    if (args[0] !== "workers") return [];
    const page = args[args.indexOf("--page") + 1];
    return Array.from({ length: 100 }, (_, i) => ({ id: "worker-" + page + "-" + i, name: "worker" }));
  });
  assert.deepEqual(result.metadata, { error: "cli-scope-failed" });
});

// These tests execute only PowerShell with NoProfile and an injected function; no
// discovery or login-profile code is used. All Oracle config and command replies are mocked.
const powershellArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];
const powershellEnv = { ...process.env, CLOUDLINK_HOME: "D:/isolated-cli-review", OCI_CLI_CONFIG_FILE: "D:/isolated-cli-review/config" };
function powershellScript(operation, provider, fake) {
  const psSource = readFileSync(join(__dirname, "metadata.ps1"), "utf8");
  // .gitattributes checks *.ps1 out with CRLF; an LF checkout must work as well.
  const at = psSource.search(/\r?\ntry \{\r?\n  Update-ClPath\r?\n/);
  assert.ok(at > 0);
  // The registry PATH of this workstation stays out of every test unless the test supplies one.
  return `${psSource.slice(0, at)}\n$clOperation='${operation}';$clProvider='${provider}';$clBinary='ClFake';$clAccount='${provider === "oracle" ? "Production" : provider === "vercel" ? "team_current" : account}';$script:clCalls=0;\nfunction Get-ClSystemPath { @() }\n${fake}\n${psSource.slice(at)}`;
}
function powershellMetadata(stdout, stderr) {
  assert.equal((stdout + stderr).includes(privateMarker), false);
  return JSON.parse(stdout.split("__CLOUDLINK_CLI_METADATA__").at(-1).trim());
}
function powershellBridge(operation, provider, fake) {
  const result = spawnSync("powershell.exe", [...powershellArgs, powershellScript(operation, provider, fake)], {
    encoding: "utf8", timeout: 8000, env: powershellEnv,
  });
  assert.equal(result.error, undefined);
  return powershellMetadata(result.stdout, result.stderr);
}

const windowsOnly = { skip: process.platform !== "win32" };

test("Windows identity separates diagnostics and retains Unicode names and case-sensitive IDs", windowsOnly, () => {
  const metadata = powershellBridge("identity", "vercel", `
function ClFake {
  $script:clCalls++
  Write-Error '${privateMarker} diagnostic' -ErrorAction Continue
  if ($args[0] -eq 'whoami') { '{"username":"my-user","team":{"id":"team_current","slug":"production","name":"生产团队","secret":"${privateMarker}"}}' }
  elseif ($args -contains '--next') { '{"teams":[{"id":"user_stable","slug":"my-user"},{"id":"team_a","slug":"lower"}],"pagination":{"next":null}}' }
  else { '{"teams":[{"id":"user_stable","slug":"my-user"},{"id":"team_current","slug":"production"},{"id":"team_A","slug":"upper"}],"pagination":{"next":123}}' }
}`);
  assert.equal(metadata.team.name, "生产团队");
  assert.deepEqual(metadata.teams.map(team => team.id), ["user_stable", "team_current", "team_A", "team_a"]);
});

test("Windows nonzero unauthenticated JSON does not expose credentials", windowsOnly, () => {
  const metadata = powershellBridge("identity", "vercel", `
function ClFake { Set-Variable -Name LASTEXITCODE -Scope Global -Value 1; '{"authenticated":false,"expired":true,"token":"${privateMarker}"}' }
`);
  assert.deepEqual(metadata, { authenticated: false, expired: true });
});

test("Windows rejects object-valued public names without coercing nested credentials", windowsOnly, () => {
  const metadata = powershellBridge("scope", "vercel", `
function ClFake { '{"projects":[{"id":"prj_valid","name":{"secret":"${privateMarker}"}}],"pagination":{"next":null}}' }
`);
  assert.deepEqual(metadata, { error: "cli-scope-failed" });
});

test("Windows Vercel pagination rejects a cursor cycle", windowsOnly, () => {
  const metadata = powershellBridge("scope", "vercel", `
function ClFake {
  $script:clCalls++
  $next=if ($script:clCalls -eq 2) {456} else {123}
  @{projects=@(@{id=('prj_'+$script:clCalls);name='Project'});pagination=@{next=$next}} | ConvertTo-Json -Depth 5 -Compress
}`);
  assert.deepEqual(metadata, { error: "cli-scope-failed" });
});

test("Windows OCI uses plain data queries, skips terminated instances and keeps instances without VNIC access", windowsOnly, () => {
  const metadata = powershellBridge("scope", "oracle", `
function Get-ClOciConfig { $script:clOciConfigFile='D:/isolated-cli-review/config'; $p=[Collections.Specialized.OrderedDictionary]::new([StringComparer]::Ordinal);$p['DEFAULT']='ocid1.tenancy.test.example';$p['Production']='';return $p }
function ClFake {
  if ($args -notcontains '--config-file' -or $args[$args.IndexOf('--config-file')+1] -ne 'D:/isolated-cli-review/config') { throw 'unsafe-config' }
  if ($args -contains 'compartment') { '["ocid1.compartment.test.allowed","ocid1.compartment.test.network-denied"]';return }
  if ($args -contains '--query' -and $args[$args.IndexOf('--query')+1] -ne 'data') { throw 'quoted-native-query' }
  if ($args -contains 'list-vnics') {
    if ($args -contains 'ocid1.instance.test.no-network') { Set-Variable -Name LASTEXITCODE -Scope Global -Value 1; Write-Error '403 NotAuthorizedOrNotFound ${privateMarker}' -ErrorAction Continue;return }
    '[{"public-ip":"203.0.113.7","private-ip":"10.0.0.1","secret":"${privateMarker}"}]';return
  }
  if ($args -contains 'ocid1.tenancy.test.example') { Set-Variable -Name LASTEXITCODE -Scope Global -Value 1; Write-Error '404 NotAuthorizedOrNotFound ${privateMarker}' -ErrorAction Continue;return }
  if ($args -contains 'ocid1.compartment.test.allowed') { '[{"id":"ocid1.instance.test.live","display-name":"计算节点","lifecycle-state":"RUNNING","metadata":{"secret":"${privateMarker}"}},{"id":"ocid1.instance.test.deleted","display-name":"Deleted","lifecycle-state":"TERMINATED"}]';return }
  '[{"id":"ocid1.instance.test.no-network","display-name":"No network","lifecycle-state":"RUNNING"}]'
}`);
  assert.equal(metadata.items.length, 2);
  assert.deepEqual(metadata.items.find(item => item.id === "ocid1.instance.test.live"), {
    id: "ocid1.instance.test.live", kind: "instance", name: "计算节点", address: "203.0.113.7",
  });
  assert.equal(metadata.items.find(item => item.id === "ocid1.instance.test.no-network").address, null);
});

test("Windows Cloudflare scope binds the account, keeps DNS failures optional and projects Pages sources", windowsOnly, () => {
  const metadata = powershellBridge("scope", "cloudflare", `
function Get-ClCfList([string[]]$arguments,[int]$size=100) {
  if ($arguments[0] -eq 'zones') {
    if ($arguments.Count -ne 4 -or $arguments[1] -ne 'list' -or $arguments[2] -ne '--account-id' -or $arguments[3] -cne '${account}') { throw 'unsafe-zone-arguments' }
    return ,@(@{id='${zoneId}';name='zone-0.example';account=@{id='${account}'}}, @{id='${otherZoneId}';name='zone-1.example';account=@{id='${account}'}})
  }
  if ($arguments[0] -eq 'dns') {
    if ($arguments[1] -ne 'records' -or $arguments[2] -ne 'list' -or $arguments[3] -ne '--zone' -or $arguments[4] -notin @('${zoneId}','${otherZoneId}') -or $arguments[5] -ne '--type') { throw 'unsafe-dns-arguments' }
    throw 'cli-scope-permission'
  }
  if ($arguments[0] -eq 'workers') { return ,@(@{id='api';name='api'}) }
  if ($arguments[0] -eq 'pages') { return ,@(@{name='web';source=@{type='github';config=@{owner='acme';repo_name='site';repo_id='456';secret='${privateMarker}'}}}) }
  throw 'unexpected-command'
}
`);
  assert.deepEqual(metadata.items.filter(item => item.kind === "zone"), unlinkedZones);
  assert.deepEqual(metadata.items.find(item => item.kind === "worker"), { id: "worker:api", kind: "worker", name: "api" });
  assert.deepEqual(metadata.items.find(item => item.kind === "pages").repoSource, { host: "github.com", owner: "acme", repo: "site", repoId: "456" });
});

test("Windows Cloudflare lists ask for page one hundred per page and stop on a short page", windowsOnly, () => {
  const metadata = powershellBridge("scope", "cloudflare", `
function Invoke-ClJson([string[]]$arguments,[bool]$allowUnavailable=$false) {
  if ($arguments[0] -eq 'zones') { return ,@(@{id='${zoneId}';name='example.com';account=@{id='${account}'}}) }
  if ($arguments[0] -eq 'dns') { return ,@() }
  if ($arguments[0] -eq 'pages') { return ,@() }
  if ($arguments[0] -eq 'workers') {
    if ($arguments[-2] -ne '--per-page' -or $arguments[-1] -ne '100') { throw 'wrong-size' }
    $page=[int]$arguments[$arguments.IndexOf('--page')+1]
    if ($page -eq 1) { return ,@(0..99 | ForEach-Object { @{id=('w'+$_);name=('w'+$_)} }) }
    if ($page -eq 2) { return ,@(@{id='last';name='last'}) }
    throw 'extra-page'
  }
  throw 'unexpected-command'
}
`);
  assert.equal(metadata.items.filter(item => item.kind === "worker").length, 101);
  assert.equal(metadata.items.at(-1).id, "worker:last");
});

test("Windows catalog responses over five hundred items stop at the limit", windowsOnly, () => {
  const metadata = powershellBridge("scope", "cloudflare", `
function Invoke-ClJson([string[]]$arguments,[bool]$allowUnavailable=$false) {
  if ($arguments[0] -eq 'zones') { return ,@() }
  if ($arguments[0] -eq 'dns') { return ,@() }
  if ($arguments[0] -eq 'pages') { return ,@() }
  if ($arguments[0] -eq 'workers') {
    $page=$arguments[$arguments.IndexOf('--page')+1]
    return ,@(0..99 | ForEach-Object { @{id=('w'+$page+'-'+$_);name='worker'} })
  }
  throw 'unexpected-command'
}
`);
  assert.deepEqual(metadata, { error: "cli-scope-failed" });
});

test("Windows native stderr cannot contaminate a successful JSON response", windowsOnly, () => {
  // cmd executes only these two literal echo statements; it never receives CLI input.
  const metadata = powershellBridge("identity", "cloudflare", `
function ClFake { & $env:ComSpec /D /C 'echo {} & echo ${privateMarker} 1>&2' }
`);
  assert.deepEqual(metadata, {});
});

test("Windows discovery finds a CLI whose directory joined PATH after the parent process started", windowsOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), "cloudlink-cli-path-"));
  try {
    writeFileSync(join(dir, "cf.cmd"), "@exit /b 0\r\n");
    const root = process.env.SystemRoot || "C:\\Windows";
    // What a process started before the install still holds: system directories only.
    const env = Object.fromEntries(Object.entries(powershellEnv).filter(([name]) => name.toLowerCase() !== "path"));
    env.Path = [join(root, "System32"), root, join(root, "System32", "WindowsPowerShell", "v1.0")].join(";");
    const discover = systemPath => {
      const script = powershellScript("discover", "cloudflare", `function Get-ClSystemPath { ${systemPath} }`);
      const result = spawnSync("powershell.exe", [...powershellArgs, script], { encoding: "utf8", timeout: 8000, env });
      assert.equal(result.error, undefined);
      return powershellMetadata(result.stdout, result.stderr);
    };
    assert.deepEqual(discover("@()"), { installed: false, nodeVersion: "" });
    // The registry now lists the new directory; a scope without a PATH value reads as null.
    const found = discover(`@('${dir.replaceAll("'", "''")}', $null)`);
    assert.equal(found.installed, true);
    assert.equal(found.path.toLowerCase(), join(dir, "cf.cmd").toLowerCase());
    // node is absent from the stripped PATH, so the version stays empty for the caller to ignore.
    assert.equal(found.nodeVersion, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function oracleBridge(operation, fake, override = true) {
  const oracleSource = readFileSync(join(__dirname, "oracle.py"), "utf8");
  const script = `
import io, json, os, re, subprocess, sys, time
from unittest.mock import patch
SOURCE=${JSON.stringify(oracleSource)}
MARKER=${JSON.stringify(privateMarker)}
EXPECTED='/isolated/oci-config' if ${override ? "True" : "False"} else '/isolated/home/.oci/config'
ENV={'OCI_CLI_CONFIG_FILE':EXPECTED,'CLOUDLINK_HOME':'/isolated/home'} if ${override ? "True" : "False"} else {'CLOUDLINK_HOME':'/isolated/home'}
CONFIG='[DEFAULT]\\ntenancy=ocid1.tenancy.test.example\\nkey_file='+MARKER+'\\npass_phrase='+MARKER+'\\n[Production]\\n[production]\\n'
def is_file(filename):
    assert filename.replace('\\\\','/') == EXPECTED
    return True
def open_config(filename, **kwargs):
    assert filename.replace('\\\\','/') == EXPECTED
    return io.StringIO(CONFIG)
def reply(arguments, data=None, status=0, stderr=''):
    return subprocess.CompletedProcess(arguments,status,json.dumps(data).encode(),stderr.encode())
${fake}
sys.argv=['bridge',${JSON.stringify(operation)},'oracle','/isolated/oci','Production']
with patch.dict(os.environ,ENV,clear=True), patch('os.path.isfile',is_file), patch('os.path.getsize',return_value=100), patch('builtins.open',open_config), patch('subprocess.run',fake_call):
    exec(compile(SOURCE,'oracle.py','exec'),{'__name__':'__main__'})
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", script], {
    encoding: "utf8", timeout: 8000,
  });
  assert.equal(result.error, undefined);
  assert.equal((result.stdout + result.stderr).includes(privateMarker), false);
  return JSON.parse(result.stdout.split("__CLOUDLINK_CLI_METADATA__").at(-1).trim());
}

test("OCI profile parsing keeps only names and uses the isolated config without a real HOME fallback", () => {
  const metadata = oracleBridge("profiles", `
def fake_call(*args,**kwargs):
    raise AssertionError('profiles must not execute OCI')
`, false);
  assert.deepEqual(metadata, { profiles: ["DEFAULT", "Production", "production"] });
});

test("OCI quoted queries keep visible instances when one compartment or VNIC is unavailable", () => {
  const metadata = oracleBridge("scope", `
def fake_call(arguments, **kwargs):
    assert arguments[:7] == ['/isolated/oci','--profile','Production','--config-file',EXPECTED,'--output','json']
    if 'compartment' in arguments:
        return reply(arguments,['ocid1.compartment.test.allowed','ocid1.compartment.test.network-denied'])
    if 'list-vnics' in arguments:
        assert arguments[-1] == 'data[]."public-ip"'
        if 'ocid1.instance.test.no-network' in arguments:
            return reply(arguments,status=1,stderr='403 NotAuthorizedOrNotFound '+MARKER)
        return reply(arguments,['203.0.113.7',None])
    assert arguments[-1] == 'data[].{id:id,name:"display-name",state:"lifecycle-state"}'
    if 'ocid1.tenancy.test.example' in arguments:
        return reply(arguments,status=1,stderr='404 NotAuthorizedOrNotFound '+MARKER)
    if 'ocid1.compartment.test.allowed' in arguments:
        return reply(arguments,[{'id':'ocid1.instance.test.live','name':'Compute','state':'RUNNING'},{'id':'ocid1.instance.test.deleted','name':'Deleted','state':'TERMINATED'}])
    return reply(arguments,[{'id':'ocid1.instance.test.no-network','name':'No network','state':'RUNNING'}])
`);
  assert.deepEqual(metadata.items, [
    { id: "ocid1.instance.test.live", kind: "instance", name: "Compute", address: "203.0.113.7" },
    { id: "ocid1.instance.test.no-network", kind: "instance", name: "No network", address: null },
  ]);
});

test("Vercel Git binding projection keeps public repository identity, never hooks or credentials", async () => {
  const result = await bridge("scope", "vercel", () => ({projects:[{id:"prj_app",name:"App",link:{type:"github",org:"acme",repo:"app",repoId:123,gitCredentialId:privateMarker,deployHooks:[{url:privateMarker}]}}],pagination:{next:null}}));
  assert.deepEqual(result.metadata.items[0].repoSource,{host:"github.com",owner:"acme",repo:"app",repoId:"123"});
});

test("Cloudflare Pages repository source is public evidence and not a deployment token", async () => {
  const result = await bridge("scope", "cloudflare", args => args[0] === "pages"
    ? [{name:"web",source:{type:"github",config:{owner:"acme",repo_name:"site",repo_id:"456",secret:privateMarker}},deployment_configs:{production:{env_vars:{secret:privateMarker}}}}]
    : []);
  assert.deepEqual(result.metadata.items[0].repoSource,{host:"github.com",owner:"acme",repo:"site",repoId:"456"});
});

test("untrusted repository URLs and object-valued source names do not become evidence", async () => {
  const result = await bridge("scope", "vercel", () => ({projects:[
    {id:"prj_url",name:"App",gitRepository:{type:"github",url:"https://"+privateMarker+"@github.com/acme/app"}},
    {id:"prj_obj",name:"Site",link:{type:"github",org:{secret:privateMarker},repo:"app"}}
  ],pagination:{next:null}}));
  assert.equal(result.metadata.items.some(item=>item.repoSource),false);
});

test("Windows Vercel Git binding projection excludes credentials", windowsOnly, () => {
  const metadata = powershellBridge("scope", "vercel", `
function ClFake { '{"projects":[{"id":"prj_app","name":"App","link":{"type":"github","org":"acme","repo":"app","repoId":123,"gitCredentialId":"${privateMarker}"}}],"pagination":{"next":null}}' }
`);
  assert.deepEqual(metadata.items[0].repoSource,{host:"github.com",owner:"acme",repo:"app",repoId:"123"});
});

test("Windows Pages source excludes deployment config contents", windowsOnly, () => {
  const metadata = powershellBridge("scope", "cloudflare", `
function Get-ClCfList([string[]]$arguments,[int]$size=100) {
 if ($arguments[0] -eq 'pages') { return ,@(@{name='web';source=@{type='github';config=@{owner='acme';repo_name='site';repo_id='456';secret='${privateMarker}'}};deployment_configs=@{secret='${privateMarker}'}}) }
 return ,@()
}
`);
  assert.deepEqual(metadata.items[0].repoSource,{host:"github.com",owner:"acme",repo:"site",repoId:"456"});
});

test("OCI rejects an object-valued name without coercing nested credentials", () => {
  const metadata = oracleBridge("scope", `
def fake_call(arguments, **kwargs):
    if 'compartment' in arguments or 'list-vnics' in arguments:
        return reply(arguments,[])
    return reply(arguments,[{'id':'ocid1.instance.test.live','name':{'secret':MARKER},'state':'RUNNING'}])
`);
  assert.deepEqual(metadata, { error: "cli-scope-failed" });
});
