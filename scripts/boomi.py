#!/usr/bin/env python3
"""Package and deploy Boomi components using the Platform API."""

import base64
import json
import os
import sys
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

    values = list(environments.values())
    for component in components:
        if not isinstance(component, dict):
            fail("Every component entry must be a JSON object.")
        values.extend(component.get(key, "") for key in ("name", "id", "version"))
    if any(not value or "REPLACE_WITH" in str(value) for value in values):
        fail("Replace every REPLACE_WITH placeholder in manifests/release.json.")
    return manifest


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
    for component in manifest["components"]:
        print(
            "Packaging " + component["name"] + " at version " + component["version"] + "..."
        )
        response = client.post(
            "PackagedComponent",
            {
                "componentId": component["id"],
                "packageVersion": component["version"],
                "notes": manifest.get("notes", ""),
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

    expected_names = [component["name"] for component in manifest["components"]]
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
                "notes": manifest.get("notes", ""),
            },
        )
        deployment_id = response.get("deploymentId")
        if not deployment_id:
            fail("Boomi did not return deploymentId for " + name + ".")
        print("Created deployment " + deployment_id + " for " + name + ".")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "package", "deploy"):
        fail("Usage: python scripts/boomi.py check|package|deploy <dev|prod>")
    if sys.argv[1] == "deploy" and len(sys.argv) != 3:
        fail("Usage: python scripts/boomi.py deploy <dev|prod>")
    if sys.argv[1] != "deploy" and len(sys.argv) != 2:
        fail("Unexpected command arguments.")

    client = BoomiClient(load_credentials())
    if sys.argv[1] == "check":
        check(client)
    elif sys.argv[1] == "package":
        package(client)
    else:
        deploy(client, sys.argv[2])


if __name__ == "__main__":
    main()