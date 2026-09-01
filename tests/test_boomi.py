import json
import os
import tempfile
import unittest
from unittest.mock import patch

from scripts import boomi


class FakeClient:
    def __init__(self, package_id, active=True):
        self.package_id = package_id
        self.active = active
        self.calls = []

    def post(self, endpoint, payload):
        self.calls.append((endpoint, payload))
        if endpoint == "DeployedPackage":
            return {"deploymentId": "deployment-id"}
        if endpoint == "DeployedPackage/query":
            return {
                "result": [
                    {"packageId": self.package_id, "componentId": "component-id", "active": self.active}
                ]
            }
        raise AssertionError("Unexpected endpoint: " + endpoint)


class DeploymentValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.packages_path = os.path.join(self.temp_dir.name, "packages.json")
        with open(self.packages_path, "w", encoding="utf-8") as file:
            json.dump({"Process A": "package-id"}, file)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_validate_requires_exact_active_package(self):
        client = FakeClient("package-id")
        with patch.object(boomi, "PACKAGES_PATH", self.packages_path):
            boomi.validate(client, "dev")
        query = client.calls[0][1]["QueryFilter"]["expression"]["nestedExpression"]
        self.assertIn(
            {"operator": "EQUALS", "property": "packageId", "argument": ["package-id"]},
            query,
        )
        self.assertIn(
            {"operator": "EQUALS", "property": "active", "argument": ["true"]},
            query,
        )

    def test_rollback_redeploys_and_validates_selected_package(self):
        client = FakeClient("package-id")
        with patch.object(boomi, "PACKAGES_PATH", self.packages_path), patch.dict(
            os.environ,
            {
                "BOOMI_ROLLBACK_PACKAGE_ID": "package-id",
                "BOOMI_ROLLBACK_COMPONENT_NAME": "Process A",
                "BOOMI_ROLLBACK_COMPONENT_ID": "component-id",
            },
            clear=False,
        ):
            boomi.rollback(client, "dev")
        self.assertEqual(client.calls[0][0], "DeployedPackage/query")
        self.assertEqual(client.calls[1][0], "DeployedPackage")
        self.assertEqual(client.calls[1][1]["packageId"], "package-id")
        self.assertTrue(any(endpoint == "DeployedPackage/query" for endpoint, _ in client.calls))


if __name__ == "__main__":
    unittest.main()
