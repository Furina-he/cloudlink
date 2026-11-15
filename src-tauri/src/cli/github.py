# Fixed GitHub metadata operations. API bodies/tokens/diagnostics stay inside this process.
import json
import re
import subprocess
import sys
import time

OPERATION, PROVIDER, BINARY, ACCOUNT = sys.argv[1:5]
HOST = sys.argv[5] if len(sys.argv) == 6 else "github.com"
STARTED = time.monotonic()
MAX_BYTES = 1024 * 1024
MAX_ITEMS = 500
MAX_PAGES = 6
OWNER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}$")
REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$")
NODE_ID = re.compile(r"^[A-Za-z0-9_=-]{1,128}$")
HOST_PATTERN = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$")


class MetadataError(Exception):
    def __init__(self, reason, status="offline"):
        super().__init__(reason)
        self.status = status


def fail(reason, status="offline"):
    raise MetadataError(reason, status)


def timeout():
    left = 25 - (time.monotonic() - STARTED)
    if left <= 0:
        fail("pagination-incomplete", "partial")
    return min(left, 8)


def run(arguments):
    try:
        result = subprocess.run(
            [BINARY] + arguments,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout(), check=False,
        )
    except (OSError, subprocess.SubprocessError):
        fail("offline")
    if len(result.stdout) > MAX_BYTES or len(result.stderr) > MAX_BYTES:
        fail("pagination-incomplete", "partial")
    diagnostic = (result.stderr + result.stdout).decode("utf-8", errors="replace")
    return result.returncode, result.stdout, diagnostic


def api(endpoint):
    code, stdout, diagnostic = run(["api", "--hostname", HOST, "--method", "GET", endpoint])
    if code:
        lowered = diagnostic.lower()
        if re.search(r"rate.?limit|429", lowered):
            fail("rate-limited", "partial")
        if re.search(r"401|403|404|bad credentials|not found|saml|forbidden|not logged|gh auth login", lowered):
            fail("permission-denied", "denied")
        fail("offline")
    try:
        return json.loads(stdout)
    except ValueError:
        fail("invalid-metadata", "partial")


def project_owner(value):
    if not isinstance(value, dict):
        fail("invalid-metadata", "partial")
    node, login, kind = value.get("node_id"), value.get("login"), value.get("type")
    if not isinstance(node, str) or not NODE_ID.fullmatch(node) or not isinstance(login, str) or not OWNER.fullmatch(login):
        fail("invalid-metadata", "partial")
    if kind not in ("User", "Organization"):
        fail("invalid-metadata", "partial")
    return {"id": node, "login": login, "kind": "user" if kind == "User" else "organization"}


def effective_identity():
    # The authenticated API response reflects GH_TOKEN/GITHUB_TOKEN precedence, not
    # merely the keyring's active account. No auth status refresh or token export.
    owner = project_owner(api("user"))
    if owner["kind"] != "user":
        fail("permission-denied", "denied")
    return {"id": owner["id"], "login": owner["login"], "host": HOST}


def identity():
    try:
        value = effective_identity()
        return {"loggedIn": True, "login": value["login"], "identity": value}
    except MetadataError as error:
        if error.status == "denied":
            return {"loggedIn": False, "expired": True}
        fail("cli-scope-failed")


def list_pages(endpoint, project, maximum):
    items, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        data = api(endpoint + ("&" if "?" in endpoint else "?") + "per_page=100&page=" + str(page))
        if not isinstance(data, list):
            fail("invalid-metadata", "partial")
        for raw in data:
            value = project(raw)
            if value["id"] in seen:
                fail("pagination-incomplete", "partial")
            if len(items) >= maximum:
                fail("pagination-incomplete", "partial")
            seen.add(value["id"])
            items.append(value)
        if len(data) < 100:
            return items
    fail("pagination-incomplete", "partial")


def project_repo(value, owner):
    if not isinstance(value, dict):
        fail("invalid-metadata", "partial")
    raw_owner = project_owner(value.get("owner"))
    node, name = value.get("node_id"), value.get("full_name")
    if raw_owner["id"] != owner["id"] or raw_owner["login"].lower() != owner["login"].lower():
        fail("owner-changed", "partial")
    if not isinstance(node, str) or not NODE_ID.fullmatch(node) or not isinstance(name, str) or not REPO.fullmatch(name):
        fail("invalid-metadata", "partial")
    if name.split("/", 1)[0].lower() != owner["login"].lower():
        fail("owner-changed", "partial")
    item = {"id": "repo:" + node, "kind": "repo", "name": name, "ownerId": owner["id"], "selected": False}
    database_id = value.get("id")
    if type(database_id) is int and database_id > 0 and len(str(database_id)) <= 20:
        item["databaseId"] = str(database_id)
    branch = value.get("default_branch")
    if isinstance(branch, str) and branch and len(branch) <= 255 and not re.search(r"[\x00-\x20\x7f`|\\~^:?*\[]", branch):
        item["defaultBranch"] = branch
    visibility = value.get("visibility")
    if visibility in ("public", "private", "internal"):
        item["visibility"] = visibility
    elif isinstance(value.get("private"), bool):
        item["visibility"] = "private" if value["private"] else "public"
    return item


def github_scope():
    result = {"status": "complete", "owners": [], "items": []}
    try:
        current = effective_identity()
        result["identity"] = current
        personal = {"id": current["id"], "login": current["login"], "kind": "user"}
        result["owners"] = [personal]
        if not ACCOUNT:
            result["owners"] += list_pages("user/orgs", project_owner, 100)
        else:
            if not OWNER.fullmatch(ACCOUNT):
                fail("invalid-owner", "denied")
            owner = project_owner(api("users/" + ACCOUNT))
            if owner["kind"] == "user" and owner["id"] != current["id"]:
                fail("permission-denied", "denied")
            result["owner"] = owner
            if owner["id"] != personal["id"]:
                result["owners"].append(owner)
            endpoint = "user/repos?affiliation=owner" if owner["kind"] == "user" else "orgs/" + owner["login"] + "/repos?type=all"
            # No archived/private filtering: auto covers every accessible repository.
            result["items"] = list_pages(endpoint, lambda repo: project_repo(repo, owner), MAX_ITEMS)
        if effective_identity() != current:
            result["items"] = []
            fail("identity-changed", "denied")
    except MetadataError as error:
        result["status"] = error.status
        result["reasonId"] = str(error)
        # Incomplete pages never establish additions. The desktop retains its prior snapshot.
        result["items"] = []
    return result


def main():
    if PROVIDER != "github" or not BINARY.startswith("/") or not HOST_PATTERN.fullmatch(HOST) or ".." in HOST:
        fail("cli-command-unsupported")
    if OPERATION == "identity":
        return identity()
    if OPERATION in ("scope", "github-scope", "github-owners"):
        return github_scope()
    fail("cli-command-unsupported")


try:
    METADATA = main()
except Exception as error:
    error_id = str(error) if isinstance(error, MetadataError) and str(error) in ("cli-command-unsupported", "cli-scope-failed") else "cli-scope-failed"
    METADATA = {"error": error_id}
print("\n__CLOUDLINK_CLI_METADATA__\n" + json.dumps(METADATA, separators=(",", ":")))
if "error" in METADATA:
    sys.exit(1)
