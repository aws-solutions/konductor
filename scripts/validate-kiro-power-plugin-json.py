#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Validate a rendered plugin.json against the Agent Plugins v1.0.0
manifest schema (vendored at scripts/agent-plugins.schema.json, fetched
from https://agent-plugins.org/schemas/1.0.0/plugin.schema.json).

Deliberately a small, hand-written, stdlib-only checker rather than a
dependency on the third-party `jsonschema` package: this repo's Makefile
states "Works standalone for any developer or OSS consumer with cargo and
make installed. No internal build tooling required" (root Makefile), and
this repo carries no requirements.txt/pyproject.toml anywhere -- every
other scripts/*.py file here uses only the standard library. Adding a pip
dependency just for this one check would break that property. The schema
itself is small, flat, and stable enough (one object, no $ref, no
oneOf/anyOf) that hand-checking it directly is a reasonable trade, and the
vendored schema file remains the human-readable source of truth this
script's checks are kept in sync with.

Usage:
  validate-kiro-power-plugin-json.py <plugin.json>

Exits 0 and prints nothing on success. Exits 1 and prints every violation
found (not just the first) to stderr on failure.
"""
import json
import re
import sys
from pathlib import Path

_NAME_PATTERN = re.compile(r"^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")
_EXPECTED_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"

# Root-level keys the schema's own `properties` declares. `additionalProperties:
# false` at the root means anything outside this set is a violation.
_ROOT_STRING_FIELDS = ("version", "description", "homepage", "repository", "license")
_KNOWN_ROOT_FIELDS = frozenset(
    {"$schema", "name", "author", "keywords", "extensions", *_ROOT_STRING_FIELDS}
)
# `author`'s own `additionalProperties: false` sub-object.
_KNOWN_AUTHOR_FIELDS = frozenset({"name", "email", "url"})


def validate(plugin: dict) -> list[str]:
    errors: list[str] = []

    if not isinstance(plugin, dict):
        return ["root document must be a JSON object"]

    unknown_root = set(plugin.keys()) - _KNOWN_ROOT_FIELDS
    if unknown_root:
        errors.append(
            f"root object has additional properties not allowed by the schema: {sorted(unknown_root)}"
        )

    # required: ["$schema", "name"]
    if "$schema" not in plugin:
        errors.append("missing required field: $schema")
    elif plugin["$schema"] != _EXPECTED_SCHEMA_ID:
        errors.append(
            f"$schema must equal the const value {_EXPECTED_SCHEMA_ID!r}, got {plugin['$schema']!r}"
        )

    if "name" not in plugin:
        errors.append("missing required field: name")
    else:
        name = plugin["name"]
        if not isinstance(name, str):
            errors.append(f"name must be a string, got {type(name).__name__}")
        elif not (1 <= len(name) <= 64):
            errors.append(f"name must be 1-64 characters, got {len(name)}")
        elif not _NAME_PATTERN.match(name):
            errors.append(
                f"name {name!r} does not match the required pattern "
                "(lowercase letters/digits/./-, no leading/trailing separator, no '--' or '..')"
            )

    for field in _ROOT_STRING_FIELDS:
        if field in plugin and not isinstance(plugin[field], str):
            errors.append(f"{field} must be a string, got {type(plugin[field]).__name__}")

    if "author" in plugin:
        author = plugin["author"]
        if not isinstance(author, dict):
            errors.append(f"author must be an object, got {type(author).__name__}")
        else:
            unknown_author = set(author.keys()) - _KNOWN_AUTHOR_FIELDS
            if unknown_author:
                errors.append(
                    f"author has additional properties not allowed by the schema: {sorted(unknown_author)}"
                )
            for field in ("name", "email", "url"):
                if field in author and not isinstance(author[field], str):
                    errors.append(f"author.{field} must be a string, got {type(author[field]).__name__}")

    if "keywords" in plugin:
        keywords = plugin["keywords"]
        if not isinstance(keywords, list):
            errors.append(f"keywords must be an array, got {type(keywords).__name__}")
        else:
            for i, kw in enumerate(keywords):
                if not isinstance(kw, str):
                    errors.append(f"keywords[{i}] must be a string, got {type(kw).__name__}")

    if "extensions" in plugin:
        extensions = plugin["extensions"]
        if not isinstance(extensions, dict):
            errors.append(f"extensions must be an object, got {type(extensions).__name__}")
        else:
            for key, value in extensions.items():
                if not isinstance(value, dict):
                    errors.append(f"extensions[{key!r}] must be an object, got {type(value).__name__}")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-kiro-power-plugin-json.py <plugin.json>", file=sys.stderr)
        return 64

    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"error: {path} not found", file=sys.stderr)
        return 1

    try:
        plugin = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: {path} is not valid JSON: {e}", file=sys.stderr)
        return 1

    errors = validate(plugin)
    if errors:
        print(f"error: {path} fails Agent Plugins v1.0.0 schema validation:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
