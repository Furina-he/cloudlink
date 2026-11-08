# Fixed GitHub CLI metadata bridge. Tokens and gh diagnostics never reach stdout.
import json
import re
import subprocess
import sys
import time

OPERATION, PROVIDER, BINARY, ACCOUNT = sys.argv[1:]
STARTED = time.monotonic()
MAX_BYTES = 1024 * 1024
MAX_ITEMS = 500
MAX_OWNERS = 20
OWNER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}$")
REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$")
NODE_ID = re.compile(r"^[A-Za-z0-9_=-]{1,64}$")


class MetadataError(Exception):
    pass


def fail(error_id):
    raise MetadataError(error_id)


def timeout():
    left = 25 - (time.monotonic() - STARTED)
    if left <= 0:
        fail("cli-scope-failed")
    return min(left, 8)


def run(arguments):
    try:
        result = subprocess.run(
            [BINARY] + arguments,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout(), check=False,
        )
    except (OSError, subprocess.SubprocessError):
        fail("cli-scope-failed")
    if len(result.stdout) > MAX_BYTES or len(result.stderr) > MAX_BYTES:
        fail("cli-scope-failed")
    text = (result.stderr + result.stdout).decode("utf-8", errors="replace")
    return result.returncode, result.stdout, text


def parse(stdout):
    try:
        return json.loads(stdout)
    except ValueError:
        fail("cli-command-unsupported")


def parse_quiet(stdout):
    try:
        return json.loads(stdout)
    except ValueError:
        return None


def identity():
    # `--json` exits 0 whatever the auth state and never includes the token (only
    # `--show-token` would). gh always acts as the active account, so only it counts.
    code, stdout, text = run(["auth", "status", "--json", "hosts"])
    data = parse_quiet(stdout)
    lowered = text.lower()
    if code == 0 and isinstance(data, dict):
        hosts = data.get("hosts")
        entries = hosts.get("github.com") if isinstance(hosts, dict) else None
        entries = entries if isinstance(entries, list) else []
        active = next((e for e in entries if isinstance(e, dict) and e.get("active") is True), None)
        if active is None:
            return {"loggedIn": False}
        login = active.get("login")
        if active.get("state") in ("success", "timeout") and isinstance(login, str) and OWNER.fullmatch(login):
            return {"loggedIn": True, "login": login}
        return {"loggedIn": False, "expired": active.get("state") == "refresh_expired"}
    if "unknown flag" in lowered:
        # Older gh without `auth status --json`: ask the API whose token is active.
        code, stdout, text = run(["api", "user", "--jq", ".login"])
        login = stdout.decode("utf-8", errors="replace").strip()
        if code == 0 and OWNER.fullmatch(login):
            return {"loggedIn": True, "login": login}
        lowered = text.lower()
        if re.search(r"401|bad credentials", lowered):
            return {"loggedIn": False, "expired": True}
        if re.search(r"gh auth login|not logged", lowered):
            return {"loggedIn": False}
        fail("cli-scope-failed")
    if re.search(r"gh auth login|not logged", lowered):
        return {"loggedIn": False}
    fail("cli-command-unsupported")


def scope():
    if not OWNER.fullmatch(ACCOUNT):
        fail("cli-account-unavailable")
    owners = [ACCOUNT]
    # Organisation membership needs read:org; without it only the user's own repositories are listed.
    code, stdout, _ = run(["api", "--method", "GET", "user/orgs", "-f", "per_page=100", "--jq", "[.[].login]"])
    if code == 0:
        orgs = parse_quiet(stdout)
        for org in orgs if isinstance(orgs, list) else []:
            if isinstance(org, str) and OWNER.fullmatch(org) and org not in owners and len(owners) < MAX_OWNERS:
                owners.append(org)
    items = []
    seen = set()
    for owner in owners:
        code, stdout, text = run([
            "repo", "list", owner, "--limit", "200",
            "--json", "id,nameWithOwner,defaultBranchRef,visibility,isArchived",
        ])
        if code:
            lowered = text.lower()
            # An organisation can hide its repositories (SSO, removed membership); keep the others.
            if owner != ACCOUNT and re.search(r"403|404|not found|could not resolve|saml", lowered):
                continue
            if re.search(r"401|bad credentials|gh auth login", lowered):
                fail("cli-scope-permission")
            fail("cli-command-unsupported")
        repos = parse(stdout)
        if not isinstance(repos, list):
            fail("cli-command-unsupported")
        for repo in repos:
            if not isinstance(repo, dict):
                fail("cli-scope-failed")
            if repo.get("isArchived") is True:
                continue
            node, name = repo.get("id"), repo.get("nameWithOwner")
            if not isinstance(node, str) or not NODE_ID.fullmatch(node) or not isinstance(name, str) or not REPO.fullmatch(name):
                fail("cli-scope-failed")
            if node in seen:
                continue
            seen.add(node)
            if len(items) >= MAX_ITEMS:
                return {"items": items}
            item = {"id": "repo:" + node, "kind": "repo", "name": name}
            branch = repo.get("defaultBranchRef")
            branch = branch.get("name") if isinstance(branch, dict) else None
            if isinstance(branch, str) and branch:
                item["defaultBranch"] = re.sub(r"[\x00-\x1f\x7f]", "", branch)[:255]
            visibility = repo.get("visibility")
            if visibility in ("PUBLIC", "PRIVATE", "INTERNAL"):
                item["visibility"] = visibility.lower()
            items.append(item)
    return {"items": items}


def main():
    if PROVIDER != "github" or not BINARY.startswith("/"):
        fail("cli-command-unsupported")
    if OPERATION == "identity":
        return identity()
    if OPERATION == "scope":
        return scope()
    fail("cli-command-unsupported")


try:
    METADATA = main()
except Exception as error:
    error_id = str(error) if isinstance(error, MetadataError) else "cli-scope-failed"
    METADATA = {"error": error_id}
print("\n__CLOUDLINK_CLI_METADATA__\n" + json.dumps(METADATA, separators=(",", ":")))
if "error" in METADATA:
    sys.exit(1)
