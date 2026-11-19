// Fixed read-only metadata bridge. `cf` credentials exist only in this child process.
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
    env: { ...process.env, ...(account ? {CLOUDFLARE_ACCOUNT_ID: account} : {}),
      CF_SEND_TELEMETRY: "false", DO_NOT_TRACK: "1", CI: "1", NO_COLOR: "1" }
  });
  if (result.error) fail("cli-scope-failed");
  let data;
  try { data = JSON.parse(result.stdout); } catch {}
  if (result.status !== 0) {
    if (identity && data && (data.authenticated === false || data.loggedIn === false)) return data;
    const text = (String(result.stderr || "") + String(result.stdout || "")).toLowerCase();
    if (identity && /not authenticated|not logged|log in|login|expired|invalid.*token|unauthorized|401|403/.test(text)) {
      return { authenticated: false, expired: /expired|invalid.*token|401/.test(text) };
    }
    fail(/permission|forbidden|403|unauthorized|401|scope/.test(text) ? "cli-scope-permission" : "cli-command-unsupported");
  }
  if (data === undefined || data === null) fail("cli-command-unsupported");
  return data;
}
function array(value) {
  if (!Array.isArray(value)) fail("cli-command-unsupported");
  return value;
}
// Git bindings are facts, not authorization. Never retain a raw remote,
// deploy-hook URL or git credential; malformed sources simply provide no evidence.
function githubSource(source) {
  if (!source || typeof source !== "object" || !["github", "github-limited", "github-custom-host"].includes(source.type)) return undefined;
  let host = source.type === "github-custom-host" ? source.host : "github.com";
  let owner = source.org || source.owner, repo = source.repo || source.repo_name;
  if (typeof repo === "string" && repo.includes("/") && !owner) [owner, repo] = repo.split("/");
  if ((!owner || !repo) && typeof source.url === "string" && !/[\s@%?#\\]/.test(source.url)) {
    const match = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(source.url);
    if (match) [, host, owner, repo] = match;
  }
  if (typeof host !== "string" || host.length > 253 || !/^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(host) || host.includes("..")
      || typeof owner !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)
      || typeof repo !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || [".", ".."].includes(repo)) return undefined;
  const result = {host: host.toLowerCase(), owner, repo};
  const id = source.repoId ?? source.repo_id;
  if (typeof id === "string" && /^(?:[0-9]{1,20}|repo:[A-Za-z0-9_=-]{1,128})$/.test(id)) result.repoId = id;
  else if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) result.repoId = String(id);
  return result;
}
function identityProjection(data) {
  const out = {};
  // A successful whoami without an explicit flag is a logged-in session (`vercel whoami`);
  // only an explicit negative, or an invalid token, is signed out.
  const denied = data.authenticated === false || data.loggedIn === false;
  out.authenticated = !denied && data.tokenValid !== false;
  out.expired = data.expired === true || data.tokenValid === false;
  if (typeof data.email === "string") out.email = clean(data.email);
  if (typeof data.username === "string") out.username = clean(data.username);
  if (Array.isArray(data.accounts)) out.accounts = data.accounts.slice(0, 100)
    .filter(item => item && typeof item.id === "string" && /^[a-fA-F0-9]{32}$/.test(item.id))
    .map(item => ({id: item.id, name: clean(item.name)}));
  for (const key of ["team", "globalTeam"]) {
    const team = data[key];
    if (team && typeof team.id === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(team.id)) {
      out[key] = {id: team.id, slug: clean(team.slug), name: clean(team.name)};
    }
  }
  return out;
}
function pages(list, size) {
  return Math.ceil(MAX_PAGES * 100 / size);
}
async function main() {
  if (!["identity", "scope"].includes(operation) || !binary || !binary.startsWith("/")) fail("cli-command-unsupported");
  if (operation === "identity") {
    if (!["cloudflare", "vercel"].includes(provider)) fail("cli-command-unsupported");
    if (provider === "cloudflare") return identityProjection(run(["auth", "whoami", "--json"], true));
    const data = run(["whoami", "--format=json"], true);
    const out = identityProjection(data);
    if (out.loggedIn === false || out.authenticated === false) return out;
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
      const value = listed.pagination && listed.pagination.next;
      if (value === null || value === undefined) return {...out, teams: [...teams.values()]};
      next = typeof value === "string" && /^[0-9]{1,16}$/.test(value) ? Number(value) : value;
      if (!Number.isSafeInteger(next) || next < 0 || seen.has(next)) fail("cli-scope-failed");
      seen.add(next);
    }
    fail("cli-scope-failed");
  }
  if (provider === "vercel") {
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(account)) fail("cli-account-unavailable");
    const items = [];
    let next; const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = ["project", "list", "--scope", account, "--format=json", "--limit", "100"];
      if (next !== undefined) args.push("--next", String(next));
      const data = run(args);
      if (!Array.isArray(data.projects)) fail("cli-command-unsupported");
      for (const project of data.projects) {
        if (!project || typeof project.id !== "string" || !project.id || project.id.length > 256
            || /[\x00-\x1f\x7f]/.test(project.id) || typeof project.name !== "string" || !project.name) {
          fail("cli-scope-failed");
        }
        const repoSource = githubSource(project.link || project.gitRepository);
        items.push({ id: project.id, kind: "project", name: clean(project.name), ...(repoSource ? {repoSource} : {}) });
        if (items.length > MAX_ITEMS) fail("cli-scope-failed");
      }
      const value = data.pagination && data.pagination.next;
      if (value === null || value === undefined) return { items };
      next = typeof value === "string" && /^[0-9]{1,16}$/.test(value) ? Number(value) : value;
      if (!Number.isSafeInteger(next) || next < 0 || seen.has(next)) fail("cli-scope-failed");
      seen.add(next);
    }
    fail("cli-scope-failed");
  }
  if (provider !== "cloudflare" || !/^[a-fA-F0-9]{32}$/.test(account)) fail("cli-account-unavailable");
  const items = [];
  function add(item) {
    if (items.length >= MAX_ITEMS) fail("cli-scope-failed");
    if (typeof item.id !== "string" || !item.id || item.id.length > 256 || /[\x00-\x1f\x7f]/.test(item.id)
        || typeof item.name !== "string" || !item.name) fail("cli-scope-failed");
    items.push(item);
  }
  function list(args, size = 100) {
    const out = [];
    for (let page = 1; page <= pages(out, size); page++) {
      const data = array(run([...args, "--page", String(page), "--per-page", String(size)]));
      if (data.length === 0) return out;
      out.push(...data);
      if (data.length < size) return out;
    }
    fail("cli-scope-failed");
  }
  let dnsReadable = true;
  for (const zone of list(["zones", "list", "--account-id", account])) {
    if (!zone || typeof zone.id !== "string" || !/^[a-fA-F0-9]{32}$/.test(zone.id)
        || typeof zone.name !== "string" || !zone.name
        || zone.account && typeof zone.account.id === "string" && zone.account.id !== account) fail("cli-scope-failed");
    const addresses = [];
    if (dnsReadable) {
      try {
        for (const type of ["A", "AAAA"]) {
          for (const record of list(["dns", "records", "list", "--zone", zone.id, "--type", type])) {
            if (typeof record.content === "string") addresses.push(record.content);
          }
        }
      } catch (error) {
        // Addresses only link a zone to a recorded server. A login that lists zones
        // but may not read their records keeps its catalog.
        if (!error || error.cloudlinkError !== "cli-scope-permission") throw error;
        dnsReadable = false;
      }
    }
    add({ id: "zone:" + zone.id, kind: "zone", name: clean(zone.name), addresses: addresses.slice(0, 500) });
  }
  for (const worker of list(["workers", "list"])) {
    if (!worker || typeof worker.id !== "string" && typeof worker.name !== "string") fail("cli-scope-failed");
    const name = typeof worker.name === "string" && worker.name ? worker.name : worker.id;
    add({ id: "worker:" + (worker.id || name), kind: "worker", name: clean(name) });
  }
  for (const project of list(["pages", "list"])) {
    if (!project || typeof project.name !== "string" || !project.name) fail("cli-scope-failed");
    const source = project.source && project.source.config;
    const repoSource = project.source && typeof project.source.type === "string" && source
      ? githubSource({...source, type: project.source.type}) : undefined;
    add({ id: "pages:" + project.name, kind: "pages", name: clean(project.name), ...(repoSource ? {repoSource} : {}) });
  }
  return { items };
}
main().then(metadata => {
  process.stdout.write("\n__CLOUDLINK_CLI_METADATA__\n" + JSON.stringify(metadata) + "\n");
}).catch(error => {
  const id = error && ["cli-account-unavailable","cli-scope-permission","cli-command-unsupported","cli-scope-failed"].includes(error.cloudlinkError)
    ? error.cloudlinkError : "cli-scope-failed";
  process.stdout.write("\n__CLOUDLINK_CLI_METADATA__\n" + JSON.stringify({ error: id }) + "\n");
  process.exitCode = 1;
});