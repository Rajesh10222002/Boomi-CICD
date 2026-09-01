#!/usr/bin/env python3
"""Package and deploy Boomi components using the Platform API."""

import base64
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(ROOT_DIR, "manifests", "release.json")
PACKAGES_PATH = os.path.join(ROOT_DIR, "packages.json")
DEFAULT_API_HOST = "https://api.boomi.com"
REQUIRED_VARIABLES = ("BOOMI_ACCOUNT_ID", "BOOMI_USERNAME", "BOOMI_TOKEN")


def fail(message):
    print("::error::" + message, file=sys.stderr)
    raise SystemExit(1)


def load_credentials():
    missing = [name for name in REQUIRED_VARIABLES if not os.environ.get(name)]
    if missing:
        fail("Missing required environment variable(s): " + ", ".join(missing))

    username = os.environ["BOOMI_USERNAME"]
    if not username.startswith("BOOMI_TOKEN."):
        username = "BOOMI_TOKEN." + username

    host = os.environ.get("BOOMI_API_HOST", DEFAULT_API_HOST).rstrip("/")
    if host not in (DEFAULT_API_HOST, "https://api.platform.gb.boomi.com"):
        fail("BOOMI_API_HOST must be the US or GB Boomi Platform API host.")

    return {
        "account_id": os.environ["BOOMI_ACCOUNT_ID"],
        "username": username,
        "token": os.environ["BOOMI_TOKEN"],
        "host": host,
    }


def load_json(path, description):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        fail(description + " not found: " + path)
    except json.JSONDecodeError as error:
        fail("Invalid JSON in " + description + ": " + str(error))


def load_manifest():
    manifest = load_json(MANIFEST_PATH, "Release manifest")
    environments = manifest.get("environments")
    components = manifest.get("components")
    if not isinstance(environments, dict) or not isinstance(components, list):
        fail("Manifest must contain an environments object and a components array.")
    if not components:
        fail("Manifest components array must contain at least one component.")
    if manifest.get("target", "dev-and-production") not in ("dev", "dev-and-production"):
        fail("Manifest target must be dev or dev-and-production.")

    values = list(environments.values())
    for component in components:
        if not isinstance(component, dict):
            fail("Every component entry must be a JSON object.")
        values.extend(component.get(key, "") for key in ("name", "id", "version"))
    if any(not value or "REPLACE_WITH" in str(value) for value in values):
        fail("Replace every REPLACE_WITH placeholder in manifests/release.json.")
    return manifest


def selected_components(manifest):
    selected_name = os.environ.get("BOOMI_COMPONENT", "").strip()
    if not selected_name:
        return manifest["components"]

    matches = [
        component
        for component in manifest["components"]
        if component["name"] == selected_name
    ]
    if not matches:
        fail("Selected component is not present in manifests/release.json: " + selected_name)
    return matches


def release_version(component):
    return os.environ.get("BOOMI_PACKAGE_VERSION", "").strip() or component["version"]


def release_notes(manifest):
    return os.environ.get("BOOMI_RELEASE_NOTES", "").strip() or manifest.get("notes", "")


def release_target(manifest):
    return os.environ.get("BOOMI_RELEASE_TARGET", "").strip() or manifest.get("target", "dev-and-production")


def release_issue_number(manifest):
    issue_number = manifest.get("issueNumber")
    return str(issue_number) if isinstance(issue_number, int) and issue_number > 0 else ""


class BoomiClient:
    def __init__(self, credentials):
        self.base_url = (
            credentials["host"]
            + "/api/rest/v1/"
            + credentials["account_id"]
            + "/"
        )
        raw_auth = (credentials["username"] + ":" + credentials["token"]).encode("utf-8")
        self.authorization = "Basic " + base64.b64encode(raw_auth).decode("ascii")

    def post(self, endpoint, payload):
        request = Request(
            self.base_url + endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": self.authorization,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            print(
                "::error::Boomi API returned HTTP "
                + str(error.code)
                + " for /"
                + endpoint
                + ": "
                + body,
                file=sys.stderr,
            )
            if endpoint == "PackagedComponent":
                print(
                    "::error::If this package version already exists, bump its version in "
                    "manifests/release.json.",
                    file=sys.stderr,
                )
            raise SystemExit(1)
        except URLError as error:
            fail("Could not reach the Boomi API: " + str(error.reason))
        except json.JSONDecodeError:
            fail("Boomi returned a non-JSON response for /" + endpoint + ".")


def check(client):
    response = client.post("Environment/query", {})
    environments = response.get("result", [])
    print("Found " + str(len(environments)) + " Boomi environment(s):")
    for environment in environments:
        print(
            "- {name} | {classification} | {id}".format(
                name=environment.get("name", "<unnamed>"),
                classification=environment.get("classification", "<unknown>"),
                id=environment.get("id", "<missing>"),
            )
        )


def package(client):
    manifest = load_manifest()
    package_ids = {}
    for component in selected_components(manifest):
        version = release_version(component)
        print(
            "Packaging " + component["name"] + " at version " + version + "..."
        )
        response = client.post(
            "PackagedComponent",
            {
                "componentId": component["id"],
                "packageVersion": version,
                "notes": release_notes(manifest),
            },
        )
        package_id = response.get("packageId")
        if not package_id:
            fail("Boomi did not return packageId for " + component["name"] + ".")
        package_ids[component["name"]] = package_id
        print("Created package " + package_id + " for " + component["name"] + ".")

    with open(PACKAGES_PATH, "w", encoding="utf-8") as file:
        json.dump(package_ids, file, indent=2)
        file.write("\n")
    print("Wrote " + str(len(package_ids)) + " package ID(s) to packages.json.")


def deploy(client, target):
    manifest = load_manifest()
    if target not in manifest["environments"]:
        fail("Unknown deployment target '" + target + "'.")
    package_ids = load_json(PACKAGES_PATH, "Package artifact")
    if not isinstance(package_ids, dict):
        fail("packages.json must contain an object mapping component names to package IDs.")

    expected_names = [component["name"] for component in selected_components(manifest)]
    if set(package_ids) != set(expected_names):
        fail("packages.json does not match the components in the release manifest.")

    environment_id = manifest["environments"][target]
    for name in expected_names:
        print("Deploying " + name + " to " + target + "...")
        response = client.post(
            "DeployedPackage",
            {
                "environmentId": environment_id,
                "packageId": package_ids[name],
                "notes": release_notes(manifest),
            },
        )
        deployment_id = response.get("deploymentId")
        if not deployment_id:
            fail("Boomi did not return deploymentId for " + name + ".")
        print("Created deployment " + deployment_id + " for " + name + ".")


def validate(client, target):
    manifest = load_manifest()
    if target not in manifest["environments"]:
        fail("Unknown validation target '" + target + "'.")
    package_ids = load_json(PACKAGES_PATH, "Package artifact")
    environment_id = manifest["environments"][target]

    for name, package_id in package_ids.items():
        print("Validating " + name + " in " + target + "...")
        found = False
        for attempt in range(6):
            response = client.post(
                "DeployedPackage/query",
                {
                    "QueryFilter": {
                        "expression": {
                            "operator": "and",
                            "nestedExpression": [
                                {"operator": "EQUALS", "property": "environmentId", "argument": [environment_id]},
                                {"operator": "EQUALS", "property": "packageId", "argument": [package_id]},
                                {"operator": "EQUALS", "property": "active", "argument": ["true"]},
                            ],
                        }
                    }
                },
            )
            found = any(record.get("packageId") == package_id and record.get("active") for record in response.get("result", []))
            if found:
                break
            if attempt < 5:
                time.sleep(5)
        if not found:
            fail("Package " + package_id + " is not active in " + target + " after deployment.")
        print("Verified package " + package_id + " is active for " + name + ".")


def rollback(client, target):
    manifest = load_manifest()
    if target not in manifest["environments"]:
        fail("Unknown rollback target '" + target + "'.")
    package_id = os.environ.get("BOOMI_ROLLBACK_PACKAGE_ID", "").strip()
    component_name = os.environ.get("BOOMI_ROLLBACK_COMPONENT_NAME", "").strip()
    component_id = os.environ.get("BOOMI_ROLLBACK_COMPONENT_ID", "").strip()
    if not package_id or not component_name or not component_id:
        fail("Rollback requires package ID, component ID, and component name configuration.")

    history = client.post(
        "DeployedPackage/query",
        {
            "QueryFilter": {
                "expression": {
                    "operator": "and",
                    "nestedExpression": [
                        {"operator": "EQUALS", "property": "environmentId", "argument": [manifest["environments"][target]]},
                        {"operator": "EQUALS", "property": "componentId", "argument": [component_id]},
                        {"operator": "EQUALS", "property": "packageId", "argument": [package_id]},
                    ],
                }
            }
        },
    )
    if not any(record.get("packageId") == package_id and record.get("componentId") == component_id for record in history.get("result", [])):
        fail("Rollback package was not previously deployed for this component in " + target + ".")

    print("Rolling back " + component_name + " in " + target + "...")
    response = client.post(
        "DeployedPackage",
        {
            "environmentId": manifest["environments"][target],
            "packageId": package_id,
            "notes": "Rollback approved through GitHub",
        },
    )
    if not response.get("deploymentId"):
        fail("Boomi did not return deploymentId for rollback of " + component_name + ".")

    package_path = PACKAGES_PATH
    with open(package_path, "w", encoding="utf-8") as file:
        json.dump({component_name: package_id}, file, indent=2)
        file.write("\n")
    validate(client, target)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "package", "deploy", "validate", "rollback", "target", "issue"):
        fail("Usage: python scripts/boomi.py check|package|deploy <dev|prod>|validate <dev|prod>|rollback <dev|prod>|target|issue")
    if sys.argv[1] in ("deploy", "validate", "rollback") and len(sys.argv) != 3:
        fail("Usage: python scripts/boomi.py " + sys.argv[1] + " <dev|prod>")
    if sys.argv[1] not in ("deploy", "validate", "rollback") and len(sys.argv) != 2:
        fail("Unexpected command arguments.")

    if sys.argv[1] in ("target", "issue"):
        manifest = load_manifest()
        value = release_target(manifest) if sys.argv[1] == "target" else release_issue_number(manifest)
        print(value)
        return

    client = BoomiClient(load_credentials())
    if sys.argv[1] == "check":
        check(client)
    elif sys.argv[1] == "package":
        package(client)
    elif sys.argv[1] == "validate":
        validate(client, sys.argv[2])
    elif sys.argv[1] == "rollback":
        rollback(client, sys.argv[2])
    else:
        deploy(client, sys.argv[2])


if __name__ == "__main__":
    main()