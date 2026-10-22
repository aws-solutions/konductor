# SPDX-License-Identifier: Apache-2.0
"""Pins that scripts/validate-kiro-power-plugin-json.py's hand-written
checks stay in sync with the vendored scripts/agent-plugins.schema.json
it is meant to validate against. The checker is deliberately a hand-
rolled, stdlib-only stand-in for a real JSON Schema validator (see that
script's own header comment) -- nothing enforces that its constants
still match the schema file after an edit to either one. This test is
that enforcement: it reads the schema's own `required`, root
`additionalProperties`, `name.pattern`, and `author.additionalProperties`
and asserts each against the checker script's own constants, imported
directly (no subprocess) since the checker's module-level names already
expose exactly what this needs.

Run:  cd tests && pytest test_validate_kiro_power_plugin_json_schema_sync.py
"""
import importlib.util
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "validate-kiro-power-plugin-json.py"
SCHEMA_PATH = REPO_ROOT / "scripts" / "agent-plugins.schema.json"


def _load_checker_module():
    # The checker's filename has hyphens, so it isn't a valid module name
    # for a plain `import` -- load it directly from its file path instead.
    spec = importlib.util.spec_from_file_location("validate_kiro_power_plugin_json", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


checker = _load_checker_module()
schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_files_exist():
    assert SCRIPT_PATH.is_file(), f"missing script: {SCRIPT_PATH}"
    assert SCHEMA_PATH.is_file(), f"missing schema: {SCHEMA_PATH}"


def test_required_list_matches():
    assert set(schema["required"]) == set(checker._REQUIRED_ROOT_FIELDS)


def test_root_additional_properties_matches():
    assert schema["additionalProperties"] is False
    assert set(schema["properties"].keys()) == set(checker._KNOWN_ROOT_FIELDS)


def test_name_pattern_matches():
    assert schema["properties"]["name"]["pattern"] == checker._NAME_PATTERN.pattern


def test_author_additional_properties_matches():
    author_schema = schema["properties"]["author"]
    assert author_schema["additionalProperties"] is False
    assert set(author_schema["properties"].keys()) == set(checker._KNOWN_AUTHOR_FIELDS)


def test_schema_id_matches():
    assert schema["$id"] == checker._EXPECTED_SCHEMA_ID
    assert schema["properties"]["$schema"]["const"] == checker._EXPECTED_SCHEMA_ID
