// Run with `node --test metadata.test.cjs`. Every CLI call and HTTP response is in
// memory; this harness never discovers binaries, reads login state or opens a socket.
// The exceptions are the Windows transport tests, which reach only a loopback listener
// that the test itself owns, and the Windows discovery test, which looks up a stand-in
// command file in a temporary directory.
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { spawn, spawnSync } = require("node:child_process");

const source = readFileSync(join(__dirname, "metadata.js"), "utf8");
const account = "11111111111111111111111111111111";
const zoneId = "22222222222222222222222222222222";
const otherZoneId = "33333333333333333333333333333333";
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
// What the live API answers, checked against a real account on 2026-11-18: a login that
// may not read DNS records gets 403, and Pages refuses a per_page above 10 with 400.
const refused = { status: 403, body: { success: false, errors: [{ code: 10000, message: privateMarker }] } };
const twoZones = () => success([zoneId, otherZoneId].map((id, i) => ({ id, name: "zone-" + i + ".example", account: { id: account } })));
const unlinkedZones = [
  { id: "zone:" + zoneId, kind: "zone", name: "zone-0.example", addresses: [] },
  { id: "zone:" + otherZoneId, kind: "zone", name: "zone-1.example", addresses: [] },
];
function pagesReply(url, total) {
  if (url.searchParams.get("per_page") !== "10") return { status: 400, body: { success: false, errors: [{ code: 8000024 }] } };
  const page = Number(url.searchParams.get("page")), from = (page - 1) * 10;
  return success(Array.from({ length: Math.max(0, Math.min(10, total - from)) }, (_, i) => ({ name: "site-" + (from + i) })), { total_pages: null });
}

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

test("Cloudflare Pages are listed ten per page, past ten requests, while total_pages is null", async () => {
  const result = await bridge("scope", "cloudflare", token, url => url.pathname.endsWith("/pages/projects") ? pagesReply(url, 105) : success([]));
  assert.equal(result.metadata.items.length, 105);
  assert.equal(result.requests.filter(url => url.pathname.endsWith("/pages/projects")).length, 11);
  assert.equal(result.requests.find(url => url.pathname.endsWith("/zones")).searchParams.get("per_page"), "100");
});

test("Cloudflare DNS records the login may not read leave zones unlinked without failing the scope", async () => {
  const result = await bridge("scope", "cloudflare", token, url => {
    if (url.pathname.endsWith("/zones")) return twoZones();
    if (url.pathname.endsWith("/dns_records")) return refused;
    return url.pathname.endsWith("/workers/scripts") ? success([{ id: "api", tag: "stable" }]) : success([]);
  });
  assert.deepEqual(result.metadata.items, [...unlinkedZones, { id: "worker:stable", kind: "worker", name: "api" }]);
  // One refusal settles it for the whole refresh.
  assert.equal(result.requests.filter(url => url.pathname.endsWith("/dns_records")).length, 1);
});

test("a DNS failure other than a refusal still fails the scope", async () => {
  const result = await bridge("scope", "cloudflare", token, url => {
    if (url.pathname.endsWith("/zones")) return twoZones();
    return url.pathname.endsWith("/dns_records") ? { status: 500, body: { secret: privateMarker } } : success([]);
  });
  assert.deepEqual(result.metadata, { error: "cli-scope-failed" });
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
// Runs the real Get-ClCf against a loopback listener standing in for the Cloudflare API,
// so the request itself and its HTTP error mapping are exercised rather than replaced.
async function powershellTransport(api) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push(url);
    const reply = request.headers.authorization === "Bearer " + privateMarker ? api(url) : { status: 500, body: {} };
    response.writeHead(reply.status || 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const child = spawn("powershell.exe", [...powershellArgs, powershellScript("scope", "cloudflare", `
$clCfApi='http://127.0.0.1:${server.address().port}'
function ClFake { '{"type":"oauth","token":"${privateMarker}"}' }`)], { env: powershellEnv, timeout: 20000 });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", text => { stdout += text; });
    child.stderr.setEncoding("utf8").on("data", text => { stderr += text; });
    await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    return { metadata: powershellMetadata(stdout, stderr), requests };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
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

test("Windows Workers and Pages use their respective pagination contracts with API key credentials", windowsOnly, () => {
  const metadata = powershellBridge("scope", "cloudflare", `
function ClFake { '{"type":"api_key","key":"${privateMarker}","email":"me@example.com"}' }
function Get-ClCf([string]$path,$query) {
  if ($clAuthHeaders['X-Auth-Key'] -ne '${privateMarker}' -or $clAuthHeaders['X-Auth-Email'] -ne 'me@example.com') { throw 'bad-headers' }
  if ($path -match '/workers/scripts$') {
    if ($query.Count) { throw 'workers-must-be-single-page' }
    return @{success=$true;result=@(0..119 | ForEach-Object { @{id=('script-'+$_);tag=('stable-'+$_)} })}
  }
  if ($path -match '/pages/projects$') {
    if ($query.per_page -ne 10) { throw 'pages-must-be-ten-per-page' }
    $result=@(if ($query.page -eq 1) { 0..9 | ForEach-Object { @{name=('page-'+$_)} } } else { @{name='last-page'} })
    return @{success=$true;result=$result;result_info=@{total_pages=$null}}
  }
  return @{success=$true;result=@();result_info=@{total_pages=1}}
}`);
  assert.equal(metadata.items.length, 131);
  assert.equal(metadata.items[0].id, "worker:stable-0");
});

test("Windows transport keeps the catalog when DNS records are refused and lists Pages ten per page", windowsOnly, async () => {
  const { metadata, requests } = await powershellTransport(url => {
    if (url.pathname === "/zones") return twoZones();
    if (url.pathname.endsWith("/dns_records")) return refused;
    if (url.pathname.endsWith("/workers/scripts")) return success([{ id: "api", tag: "stable" }]);
    return pagesReply(url, 105);
  });
  assert.deepEqual(metadata.items.filter(item => item.kind === "zone"), unlinkedZones);
  assert.deepEqual(metadata.items.filter(item => item.kind === "worker"), [{ id: "worker:stable", kind: "worker", name: "api" }]);
  assert.equal(metadata.items.filter(item => item.kind === "pages").length, 105);
  assert.equal(requests.filter(url => url.pathname.endsWith("/dns_records")).length, 1);
  assert.equal(requests.filter(url => url.pathname.endsWith("/pages/projects")).length, 11);
});

test("Windows transport tells a refused catalog from a failed one and treats missing Workers and Pages as empty", windowsOnly, async () => {
  const denied = await powershellTransport(() => refused);
  assert.deepEqual(denied.metadata, { error: "cli-scope-permission" });
  assert.equal(denied.requests.length, 1);
  const failed = await powershellTransport(() => ({ status: 500, body: { secret: privateMarker } }));
  assert.deepEqual(failed.metadata, { error: "cli-scope-failed" });
  const absent = await powershellTransport(url => url.pathname === "/zones" ? success([]) : { status: 404, body: { secret: privateMarker } });
  assert.deepEqual(absent.metadata, { items: [] });
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
    writeFileSync(join(dir, "wrangler.cmd"), "@exit /b 0\r\n");
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
    assert.deepEqual(discover("@()"), { installed: false });
    // The registry now lists the new directory; a scope without a PATH value reads as null.
    const found = discover(`@('${dir.replaceAll("'", "''")}', $null)`);
    assert.equal(found.installed, true);
    assert.equal(found.path.toLowerCase(), join(dir, "wrangler.cmd").toLowerCase());
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
  const result = await bridge("scope", "cloudflare", token, url => url.pathname.endsWith("/pages/projects")
    ? success([{name:"web",source:{type:"github",config:{owner:"acme",repo_name:"site",repo_id:"456",secret:privateMarker}},deployment_configs:{production:{env_vars:{secret:privateMarker}}}}]) : success([]));
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
function ClFake { '{"type":"oauth","token":"${privateMarker}"}' }
function Get-ClCf([string]$path,$query) {
 if ($path -match '/pages/projects$') {return @{success=$true;result=@(@{name='web';source=@{type='github';config=@{owner='acme';repo_name='site';repo_id='456';secret='${privateMarker}'}};deployment_configs=@{secret='${privateMarker}'}});result_info=@{total_pages=1}}}
 return @{success=$true;result=@();result_info=@{total_pages=1}}
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
