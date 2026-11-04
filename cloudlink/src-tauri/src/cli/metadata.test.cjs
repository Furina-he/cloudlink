// Run with `node --test metadata.test.cjs`. Every CLI call and HTTP response is in
// memory; this harness never discovers binaries, reads login state or opens a socket.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const source = readFileSync(join(__dirname, "metadata.js"), "utf8");
const account = "11111111111111111111111111111111";
const zoneId = "22222222222222222222222222222222";
const privateMarker = "fake-credential-must-stay-private";

async function bridge(operation, provider, replies, api) {
  const calls = [], requests = [];
  let output = "";
  let complete;
  const completed = new Promise(resolve => { complete = resolve; });
  const context = {
    Buffer, URL, AbortSignal,
    process: {
      argv: ["node", operation, provider, "/isolated/cli", provider === "vercel" ? "team_current" : account],
      env: { WRANGLER_WRITE_LOGS: "true" },
      stdout: { write(text) { output += text; complete(); } },
    },
    require(name) {
      assert.equal(name, "node:child_process");
      return { spawnSync(binary, args, options) {
        assert.equal(binary, "/isolated/cli");
        assert.equal(options.shell, false);
        assert.equal(options.env.WRANGLER_WRITE_LOGS, "false");
        assert.equal(options.env.WRANGLER_LOG_SANITIZE, "true");
        assert.equal(options.env.VERCEL_TELEMETRY_DISABLED, "1");
        calls.push([...args]);
        const reply = replies(args, calls.length);
        return { status: 0, stdout: JSON.stringify(reply), stderr: privateMarker, ...reply?.nativeResult };
      } };
    },
    async fetch(url, options) {
      assert.equal(url.origin, "https://api.cloudflare.com");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      requests.push(new URL(url));
      assert.ok(api, "unexpected HTTP request");
      const reply = api(url, options);
      return new Response(JSON.stringify(reply.body), { status: reply.status || 200 });
    },
  };
  vm.runInNewContext(source, context, { filename: "metadata.js", timeout: 1000 });
  await completed;
  assert.equal(output.includes(privateMarker), false);
  const metadata = JSON.parse(output.split("__CLOUDLINK_CLI_METADATA__").at(-1).trim());
  return { metadata, calls, requests };
}

const success = (result, result_info) => ({ body: { success: true, result, result_info } });
const token = () => ({ type: "oauth", token: privateMarker });

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

test("Cloudflare Workers use SinglePage even with more than 100 scripts and prefer immutable tags", async () => {
  const result = await bridge("scope", "cloudflare", token, (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer " + privateMarker);
    if (url.pathname.endsWith("/zones")) return success([]);
    if (url.pathname.endsWith("/workers/scripts")) {
      assert.equal(url.search, "");
      return success(Array.from({ length: 120 }, (_, i) => ({ id: "script-" + i, tag: "stable-" + i })));
    }
    assert.ok(url.pathname.endsWith("/pages/projects"));
    return success([]);
  });
  assert.equal(result.metadata.items.length, 120);
  assert.equal(result.metadata.items[0].id, "worker:stable-0");
  assert.equal(result.requests.filter(url => url.pathname.endsWith("/workers/scripts")).length, 1);
});

test("Cloudflare Pages continue paginating when total_pages is null", async () => {
  const result = await bridge("scope", "cloudflare", token, url => {
    if (!url.pathname.endsWith("/pages/projects")) return success([]);
    const page = Number(url.searchParams.get("page"));
    return success(page === 1 ? Array.from({ length: 100 }, (_, i) => ({ name: "page-" + i })) : [{ name: "last-page" }], { total_pages: null });
  });
  assert.equal(result.metadata.items.length, 101);
  assert.equal(result.requests.filter(url => url.pathname.endsWith("/pages/projects")).length, 2);
});

test("optional Workers and Pages 404 responses are empty scopes", async () => {
  const result = await bridge("scope", "cloudflare", token, url => url.pathname.endsWith("/zones")
    ? success([]) : { status: 404, body: { secret: privateMarker } });
  assert.deepEqual(result.metadata, { items: [] });
});

test("optional Workers 403 is a permission failure and does not query Pages", async () => {
  const result = await bridge("scope", "cloudflare", token, url => url.pathname.endsWith("/zones")
    ? success([]) : { status: 403, body: { secret: privateMarker } });
  assert.deepEqual(result.metadata, { error: "cli-scope-permission" });
  assert.equal(result.requests.some(url => url.pathname.endsWith("/pages/projects")), false);
});

test("Wrangler API key credentials stay in request headers and support metadata queries", async () => {
  const result = await bridge("scope", "cloudflare", () => ({ type: "api_key", key: privateMarker, email: "me@example.com" }), (_url, options) => {
    assert.equal(options.headers["X-Auth-Key"], privateMarker);
    assert.equal(options.headers["X-Auth-Email"], "me@example.com");
    assert.equal(options.headers.Authorization, undefined);
    return success([]);
  });
  assert.deepEqual(result.metadata, { items: [] });
});

test("Cloudflare DNS addresses remain projected public metadata within the bound account", async () => {
  const result = await bridge("scope", "cloudflare", token, url => {
    if (url.pathname.endsWith("/zones")) return success([{ id: zoneId, name: "example.com", account: { id: account }, secrets: privateMarker }]);
    if (url.pathname.endsWith("/dns_records")) return success([{ content: url.searchParams.get("type") === "A" ? "203.0.113.10" : "2001:db8::1", secrets: privateMarker }]);
    return success([]);
  });
  assert.deepEqual(result.metadata.items, [{ id: "zone:" + zoneId, kind: "zone", name: "example.com", addresses: ["203.0.113.10", "2001:db8::1"] }]);
});

test("oversized HTTP responses fail with a fixed ID", async () => {
  const result = await bridge("scope", "cloudflare", token, () => ({ body: { success: true, result: [], secret: privateMarker.repeat(40000) } }));
  assert.deepEqual(result.metadata, { error: "cli-scope-failed" });
});

// These tests execute only PowerShell with NoProfile and an injected function; no
// discovery or login-profile code is used. All Oracle config and HTTP reads are mocked.
function powershellBridge(operation, provider, fake) {
  const psSource = readFileSync(join(__dirname, "metadata.ps1"), "utf8");
  const at = psSource.indexOf("\ntry {\n  if ($clOperation");
  assert.ok(at > 0);
  const script = `${psSource.slice(0, at)}\n$clOperation='${operation}';$clProvider='${provider}';$clBinary='ClFake';$clAccount='${provider === "oracle" ? "Production" : provider === "vercel" ? "team_current" : account}';$script:clCalls=0;\n${fake}\n${psSource.slice(at)}`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", timeout: 8000,
    env: { ...process.env, CLOUDLINK_HOME: "D:/isolated-cli-review", OCI_CLI_CONFIG_FILE: "D:/isolated-cli-review/config" },
  });
  assert.equal(result.error, undefined);
  assert.equal((result.stdout + result.stderr).includes(privateMarker), false);
  return JSON.parse(result.stdout.split("__CLOUDLINK_CLI_METADATA__").at(-1).trim());
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
function ClFake { Set-Variable -Name LASTEXITCODE -Scope 1 -Value 1; '{"authenticated":false,"expired":true,"token":"${privateMarker}"}' }
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
    if ($args -contains 'ocid1.instance.test.no-network') { Set-Variable -Name LASTEXITCODE -Scope 1 -Value 1; Write-Error '403 NotAuthorizedOrNotFound ${privateMarker}' -ErrorAction Continue;return }
    '[{"public-ip":"203.0.113.7","private-ip":"10.0.0.1","secret":"${privateMarker}"}]';return
  }
  if ($args -contains 'ocid1.tenancy.test.example') { Set-Variable -Name LASTEXITCODE -Scope 1 -Value 1; Write-Error '404 NotAuthorizedOrNotFound ${privateMarker}' -ErrorAction Continue;return }
  if ($args -contains 'ocid1.compartment.test.allowed') { '[{"id":"ocid1.instance.test.live","display-name":"计算节点","lifecycle-state":"RUNNING","metadata":{"secret":"${privateMarker}"}},{"id":"ocid1.instance.test.deleted","display-name":"Deleted","lifecycle-state":"TERMINATED"}]';return }
  '[{"id":"ocid1.instance.test.no-network","display-name":"No network","lifecycle-state":"RUNNING"}]'
}`);
  assert.equal(metadata.items.length, 2);
  assert.deepEqual(metadata.items.find(item => item.id === "ocid1.instance.test.live"), {
    id: "ocid1.instance.test.live", kind: "instance", name: "计算节点", address: "203.0.113.7",
  });
  assert.equal(metadata.items.find(item => item.id === "ocid1.instance.test.no-network").address, null);
});

test("Windows Workers and Pages use their respective pagination contracts with API key credentials", windowsOnly, () => {
  const metadata = powershellBridge("scope", "cloudflare", `
function ClFake { '{"type":"api_key","key":"${privateMarker}","email":"me@example.com"}' }
function Get-ClCf([string]$path,$query) {
  if ($clAuthHeaders['X-Auth-Key'] -ne '${privateMarker}' -or $clAuthHeaders['X-Auth-Email'] -ne 'me@example.com') { throw 'bad-headers' }
  if ($path -match '/workers/scripts$') {
    if ($query.Count) { throw 'workers-must-be-single-page' }
    return @{success=$true;result=@(0..119 | ForEach-Object { @{id=('script-'+$_);tag=('stable-'+$_)} })}
  }
  if ($path -match '/pages/projects$' -and $query.page -eq 1) {
    return @{success=$true;result=@(0..99 | ForEach-Object { @{name=('page-'+$_)} });result_info=@{total_pages=$null}}
  }
  return @{success=$true;result=@();result_info=@{total_pages=1}}
}`);
  assert.equal(metadata.items.length, 220);
  assert.equal(metadata.items[0].id, "worker:stable-0");
});

test("Windows native stderr cannot contaminate a successful JSON response", windowsOnly, () => {
  // cmd executes only these two literal echo statements; it never receives CLI input.
  const metadata = powershellBridge("identity", "cloudflare", `
function ClFake { & $env:ComSpec /D /C 'echo {} & echo ${privateMarker} 1>&2' }
`);
  assert.deepEqual(metadata, {});
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

test("OCI rejects an object-valued name without coercing nested credentials", () => {
  const metadata = oracleBridge("scope", `
def fake_call(arguments, **kwargs):
    if 'compartment' in arguments or 'list-vnics' in arguments:
        return reply(arguments,[])
    return reply(arguments,[{'id':'ocid1.instance.test.live','name':{'secret':MARKER},'state':'RUNNING'}])
`);
  assert.deepEqual(metadata, { error: "cli-scope-failed" });
});
