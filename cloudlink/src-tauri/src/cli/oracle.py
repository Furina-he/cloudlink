# Fixed OCI metadata bridge. Configuration lines and CLI diagnostics never reach stdout.
import json
import os
import re
import subprocess
import sys
import time

OPERATION, PROVIDER, BINARY, ACCOUNT = sys.argv[1:]
STARTED = time.monotonic()
MAX_BYTES = 1024 * 1024
PROFILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
OCID = re.compile(r"^ocid1\.(tenancy|compartment|instance)\.[A-Za-z0-9_.-]+$")
CONFIG_FILE = os.environ.get("OCI_CLI_CONFIG_FILE") or (
    os.path.join(os.environ["CLOUDLINK_HOME"], ".oci", "config")
    if os.environ.get("CLOUDLINK_HOME") else os.path.expanduser("~/.oci/config")
)


class MetadataError(Exception):
    pass


def fail(error_id):
    raise MetadataError(error_id)


def timeout():
    left = 25 - (time.monotonic() - STARTED)
    if left <= 0:
        fail("cli-scope-failed")
    return min(left, 8)


def profiles():
    found = {}
    if not os.path.isfile(CONFIG_FILE):
        return found
    if os.path.getsize(CONFIG_FILE) > 262144:
        fail("cli-scope-failed")
    section = None
    with open(CONFIG_FILE, encoding="utf-8-sig", errors="replace") as configuration:
        for line in configuration:
            title = re.fullmatch(r"\s*\[([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})\]\s*(?:[#;].*)?", line.rstrip())
            if title:
                section = title.group(1)
                found.setdefault(section, "")
                if len(found) > 100:
                    fail("cli-scope-failed")
                continue
            tenancy = re.fullmatch(r"\s*tenancy\s*=\s*(ocid1\.tenancy\.[A-Za-z0-9_.-]+)\s*", line.rstrip())
            if section and tenancy:
                # Only a public tenancy OCID is retained, never private-key or passphrase data.
                found[section] = tenancy.group(1)
    return found


def call(arguments, identity=False, allow_unavailable=False):
    try:
        result = subprocess.run(
            [BINARY, "--profile", ACCOUNT, "--config-file", CONFIG_FILE, "--output", "json"] + arguments,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout(), check=False,
        )
    except (OSError, subprocess.SubprocessError):
        fail("cli-scope-failed")
    if len(result.stdout) > MAX_BYTES or len(result.stderr) > MAX_BYTES:
        fail("cli-scope-failed")
    if result.returncode:
        text = (result.stderr + result.stdout).decode("utf-8", errors="replace").lower()
        if identity:
            return {"authenticated": False, "expired": bool(re.search(r"expired|401|invalid.*token", text))}
        # IAM accessibility does not imply compute or VNIC permission. A denied or
        # concurrently deleted optional resource must not hide all other instances.
        if allow_unavailable and re.search(r"403|404|notauthorizedornotfound|notfound", text):
            return []
        if re.search(r"permission|forbidden|403|unauthorized|401|notauthorized", text):
            fail("cli-scope-permission")
        fail("cli-command-unsupported")
    if identity:
        return {"authenticated": True, "expired": False}
    try:
        data = json.loads(result.stdout)
        if not isinstance(data, list):
            fail("cli-command-unsupported")
        return data
    except (ValueError, TypeError):
        fail("cli-command-unsupported")


def main():
    if PROVIDER != "oracle" or not BINARY.startswith("/"):
        fail("cli-command-unsupported")
    configuration = profiles()
    if OPERATION == "profiles":
        names = list(configuration)
        if "DEFAULT" in configuration:
            names.remove("DEFAULT")
            names.insert(0, "DEFAULT")
        return {"profiles": names}
    if not PROFILE.fullmatch(ACCOUNT) or ACCOUNT not in configuration:
        fail("cli-account-unavailable")
    if OPERATION == "identity":
        return call(["iam", "region", "list", "--query", "data[].name"], identity=True)
    if OPERATION != "scope":
        fail("cli-command-unsupported")
    tenancy = configuration[ACCOUNT] or configuration.get("DEFAULT")
    if not tenancy or not tenancy.startswith("ocid1.tenancy.") or not OCID.fullmatch(tenancy):
        fail("cli-scope-failed")
    compartments = [tenancy] + call([
        "iam", "compartment", "list", "--compartment-id", tenancy, "--access-level", "ACCESSIBLE",
        "--compartment-id-in-subtree", "true", "--all", "--query", "data[].id",
    ])
    if len(compartments) > 100:
        fail("cli-scope-failed")
    items = []
    seen = set()
    seen_compartments = set()
    for compartment in compartments:
        if not isinstance(compartment, str) or not re.fullmatch(r"ocid1\.(tenancy|compartment)\.[A-Za-z0-9_.-]+", compartment):
            fail("cli-scope-failed")
        if compartment in seen_compartments:
            continue
        seen_compartments.add(compartment)
        instances = call([
            "compute", "instance", "list", "--compartment-id", compartment, "--all",
            "--query", 'data[].{id:id,name:"display-name",state:"lifecycle-state"}',
        ], allow_unavailable=True)
        for instance in instances:
            if not isinstance(instance, dict):
                fail("cli-scope-failed")
            instance_id = instance.get("id")
            if not isinstance(instance_id, str) or not instance_id.startswith("ocid1.instance.") or not OCID.fullmatch(instance_id):
                fail("cli-scope-failed")
            if instance.get("state") == "TERMINATED" or instance_id in seen:
                continue
            seen.add(instance_id)
            vnics = call([
                "compute", "instance", "list-vnics", "--instance-id", instance_id,
                "--all", "--query", 'data[]."public-ip"',
            ], allow_unavailable=True)
            address = next((ip for ip in vnics if isinstance(ip, str) and ip), None)
            name = instance.get("name")
            if not isinstance(name, str):
                fail("cli-scope-failed")
            name = re.sub(r"[\x00-\x1f\x7f]", "", name)[:128]
            if not name or len(items) >= 500:
                fail("cli-scope-failed")
            items.append({"id": instance_id, "kind": "instance", "name": name, "address": address})
    return {"items": items}


try:
    METADATA = main()
except Exception as error:
    error_id = str(error) if isinstance(error, MetadataError) else "cli-scope-failed"
    METADATA = {"error": error_id}
print("\n__CLOUDLINK_CLI_METADATA__\n" + json.dumps(METADATA, separators=(",", ":")))
if "error" in METADATA:
    sys.exit(1)
