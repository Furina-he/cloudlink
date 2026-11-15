// Fixed read-only metadata bridge. Wrangler credentials exist only in this child process.
// stdout/stderr never include auth output, API bodies, exception messages or stacks.
"use strict";
const { spawnSync } = require("node:child_process");
const [operation, provider, binary, account] = process.argv.slice(1);
const MAX_ITEMS = 500, MAX_PAGES = 10, MAX_BODY = 1024 * 1024;
const started = Date.now();
const clean = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 128) : "";
const fail = id => { throw { cloudlinkError: id }; };
function remaining() {
  const left = 25000 - (Date.now() - started);
  if (left <= 0) fail("cli-scope-failed");
  return Math.min(left, 8000);
}
function run(args, identity = false) {
  const result = spawnSync(binary, args, {
    encoding: "utf8", timeout: remaining(), maxBuffer: MAX_BODY, shell: false,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false",
      WRANGLER_LOG_SANITIZE: "true", VERCEL_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", CI: "1", NO_COLOR: "1" }
  });
  if (result.error) fail("cli-scope-failed");
  let data;
  try { data = JSON.parse(result.stdout); } catch {}
  if (result.status !== 0) {
    if (identity && data && (data.loggedIn === false || data.authenticated === false)) return data;
    const text = (String(result.stderr || "") + String(result.stdout || "")).toLowerCase();
    if (identity && /not authenticated|not logged|log in|login|expired|invalid.*token|unauthorized|401|403/.test(text)) {
      return { authenticated: false, expired: /expired|invalid.*token|401/.test(text) };
    }
    fail(/permission|forbidden|403|unauthorized|401/.test(text) ? "cli-scope-permission" : "cli-command-unsupported");
  }
  if (!data || typeof data !== "object") fail("cli-command-unsupported");
  return data;
}
function cursor(data, previous, seen) {
  const value = data.pagination && data.pagination.next;
  if (value === null || value === undefined) return undefined;
  const next = typeof value === "string" && /^[0-9]{1,16}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(next) || next < 0 || next === previous || seen.has(next)) fail("cli-scope-failed");
  seen.add(next);
  return next;
}
function identityProjection(data) {
  const out = {};
  for (const key of ["loggedIn", "authenticated", "expired"]) if (typeof data[key] === "boolean") out[key] = data[key];
  for (const key of ["email", "username"]) if (typeof data[key] === "string") out[key] = clean(data[key]);
  if (Array.isArray(data.accounts)) out.accounts = data.accounts.slice(0,100)
    .filter(account => account && typeof account.id === "string" && /^[a-fA-F0-9]{32}$/.test(account.id))
    .map(account => ({id: account.id, name: clean(account.name)}));
  for (const key of ["team", "globalTeam"]) {
    if (data[key] && typeof data[key].id === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(data[key].id)) {
      out[key] = {id: data[key].id, slug: clean(data[key].slug), name: clean(data[key].name)};
    }
  }
  return out;
}
async function main() {
  if (!["identity", "scope"].includes(operation) || !binary || !binary.startsWith("/")) fail("cli-command-unsupported");
  if (operation === "identity") {
    if (!["cloudflare", "vercel"].includes(provider)) fail("cli-command-unsupported");
    const data = run(provider === "cloudflare" ? ["whoami", "--json"] : ["whoami", "--format=json"], true);
    const out = identityProjection(data);
    if (provider === "cloudflare" || out.loggedIn === false || out.authenticated === false) return out;
    const teams = new Map(); const seen = new Set(); let next;
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = ["teams", "list", "--format=json", "--limit", "100"];
      if (next !== undefined) args.push("--next", String(next));
      const listed = run(args);
      if (!Array.isArray(listed.teams)) fail("cli-command-unsupported");
      for (const team of listed.teams) {
        if (typeof team.id !== "string" || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(team.id)) fail("cli-scope-failed");
        teams.set(team.id, {id: team.id, slug: clean(team.slug), name: clean(team.name), current: team.current === true});
        if (teams.size > 100) fail("cli-scope-failed");
      }
      next = cursor(listed, next, seen);
      if (next === undefined) return {...out, teams: [...teams.values()]};
    }
    fail("cli-scope-failed");
  }
  const items = [];
  function add(item) {
    if (items.length >= MAX_ITEMS) fail("cli-scope-failed");
    if (typeof item.id !== "string" || !item.id || item.id.length > 256 || /[\x00-\x1f\x7f]/.test(item.id)
        || typeof item.name !== "string" || !item.name) fail("cli-scope-failed");
    items.push(item);
  }
  if (provider === "vercel") {
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(account)) fail("cli-account-unavailable");
    let next; const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = ["project", "list", "--scope", account, "--format=json", "--limit", "100"];
      if (next !== undefined) args.push("--next", String(next));
      const data = run(args);
      if (!Array.isArray(data.projects)) fail("cli-command-unsupported");
      for (const project of data.projects) add({ id: project.id, kind: "project", name: clean(project.name) });
      next = cursor(data, next, seen);
      if (next === undefined) return { items };
    }
    fail("cli-scope-failed");
  }
  if (provider !== "cloudflare" || !/^[a-fA-F0-9]{32}$/.test(account)) fail("cli-account-unavailable");
  let auth = run(["auth", "token", "--json"]);
  let authHeaders;
  if (["oauth", "api_token"].includes(auth.type) && typeof auth.token === "string" && auth.token && !/[\x00-\x1f\x7f]/.test(auth.token)) {
    authHeaders = {Authorization: "Bearer " + auth.token};
  } else if (auth.type === "api_key" && typeof auth.key === "string" && auth.key && typeof auth.email === "string"
      && auth.email && !/[\x00-\x1f\x7f]/.test(auth.key + auth.email)) {
    authHeaders = {"X-Auth-Key": auth.key, "X-Auth-Email": auth.email};
  } else {
    fail("cli-command-unsupported");
  }
  auth = null;
  async function get(path, query) {
    if (!/^\/zones$|^\/zones\/[a-fA-F0-9]{32}\/dns_records$|^\/accounts\/[a-fA-F0-9]{32}\/(workers\/scripts|pages\/projects)$/.test(path)) fail("cli-scope-failed");
    const url = new URL("https://api.cloudflare.com/client/v4" + path);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(remaining()),
      headers: { ...authHeaders, Accept: "application/json" }
    });
    if ([401,403].includes(response.status)) fail("cli-scope-permission");
    if (response.status === 404 && /^\/accounts\/[^/]+\/(workers\/scripts|pages\/projects)$/.test(path)) {
      return {success: true, result: [], result_info: {total_pages: 1}};
    }
    if (!response.ok || !response.body) fail("cli-scope-failed");
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); fail("cli-scope-failed"); }
      chunks.push(Buffer.from(value));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("cli-scope-failed"); }
    if (data.success !== true || !Array.isArray(data.result)) {
      if ((data.errors || []).some(error => [10000,10001,9103,9106,9109].includes(error.code))) fail("cli-scope-permission");
      fail("cli-scope-failed");
    }
    return data;
  }
  async function list(path, query, map) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await get(path, { ...query, page, per_page: 100 });
      for (const item of data.result) await map(item);
      const total = data.result_info && data.result_info.total_pages;
      if (total != null && (!Number.isSafeInteger(total) || total < 0)) fail("cli-scope-failed");
      if (total != null ? page >= total : data.result.length < 100) return;
    }
    fail("cli-scope-failed");
  }
  try {
    await list("/zones", { "account.id": account }, async zone => {
      if (!zone.account || zone.account.id !== account || !/^[a-fA-F0-9]{32}$/.test(zone.id)) fail("cli-scope-failed");
      const addresses = [];
      await list("/zones/" + zone.id + "/dns_records", { type: "A" }, record => { if (typeof record.content === "string") addresses.push(record.content); });
      await list("/zones/" + zone.id + "/dns_records", { type: "AAAA" }, record => { if (typeof record.content === "string") addresses.push(record.content); });
      add({ id: "zone:" + zone.id, kind: "zone", name: clean(zone.name), addresses: addresses.slice(0,500) });
    });
    // The Workers scripts endpoint is SinglePage; page/per_page are ignored there.
    const workers = await get("/accounts/" + account + "/workers/scripts", {});
    for (const script of workers.result) add({ id: "worker:" + (script.tag || script.id), kind: "worker", name: clean(script.id) });
    await list("/accounts/" + account + "/pages/projects", {}, project => {
      add({ id: "pages:" + project.name, kind: "pages", name: clean(project.name) });
    });
    return { items };
  } finally { authHeaders = null; }
}
main().then(metadata => {
  process.stdout.write("\n__CLOUDLINK_CLI_METADATA__\n" + JSON.stringify(metadata) + "\n");
}).catch(error => {
  const id = error && ["cli-account-unavailable","cli-scope-permission","cli-command-unsupported","cli-scope-failed"].includes(error.cloudlinkError)
    ? error.cloudlinkError : "cli-scope-failed";
  process.stdout.write("\n__CLOUDLINK_CLI_METADATA__\n" + JSON.stringify({ error: id }) + "\n");
  process.exitCode = 1;
});
