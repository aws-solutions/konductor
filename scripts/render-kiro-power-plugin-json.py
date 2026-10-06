#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Render powers/konductor/plugin.json deterministically from
scripts/kiro-power.template.json, overriding only one field:

- `version`: read from the repo's root VERSION file, which is this repo's
  single source of truth for the released version (see
  scripts/validate-version-semver.sh and .github/workflows/release.yml's
  check-version job). This field must be generated, never hand-maintained,
  and scripts/generate-agent-files.js is NOT the right place to do it
  (that script renders Claude Code agent .md files from
  agents/*.agent-spec.json and has no notion of the Agent Plugins schema
  at all) -- hence this small, purpose-built script instead.

Every other field (name, description, author, homepage, repository,
license, keywords) is carried through from the template unchanged, in its
original key order -- this script does not know or need to know what those
fields mean; it only knows how to compute `version`.

`keywords` design note: the list in scripts/kiro-power.template.json is
deliberately two tiers, in this order. The first nine are exact-action
activation phrases a user would actually type or say to trigger this
Power's Try-power/chat entry points ("konductor", "install konductor",
"set up konductor", "update konductor", "uninstall konductor", "konductor
doctor", "konductor sop", "konductor skill", "konductor agent") -- every
one of them names the product ("konductor") to avoid matching on a bare
generic word ("doctor", "sop", "skill", "agent-spec") that some other,
unrelated Power might also claim. The trailing four ("multi agent
orchestration", "sdlc workflow", "ai sdlc workflow", "end to end
development") are intentionally broader discovery phrases -- not tied to
the word "konductor" at all -- meant to surface this Power to someone
searching or browsing by category/intent rather than by product name.
Both tiers ship in the one `keywords` array; this script has no notion of
the two-tier split and simply passes the whole list through.

Unlike scripts/render-claude-plugin-json.py (the Claude Code plugin
manifest), the Agent Plugins schema (plugin.schema.json, `additionalProperties:
false`) has no `agents` field and no path-shaped fields to rewrite for a
different tree layout -- so there is no --path-prefix / --agents-dir
equivalent here. The output is schema-validated separately (see
`make kiro-power-check`), not by this script.

Called by `make kiro-power` -- not meant to be run directly, though it is a
plain script and can be. `make kiro-power-check` does NOT call this script;
it only validates whatever powers/konductor/plugin.json already has
checked in, so run `make kiro-power` first and commit its output whenever
the template or VERSION changes. Users import the Power straight from
github.com/aws-solutions/konductor/tree/main/powers/konductor, so this
script's `--output` always writes powers/konductor/plugin.json itself, in
place -- there is no separate assembled/published copy anymore.
"""
import argparse
import json
import re
import sys
from pathlib import Path

# Mirrors the Agent Plugins v1.0.0 schema's own `name` pattern exactly
# (plugin.schema.json): lowercase letters/digits/./-, no leading/trailing
# separator, no "--" or "..". Checked here too (not just left to a
# downstream JSON-Schema validator) so a template edit that breaks this
# fails immediately, at render time, with a specific message.
_NAME_PATTERN = re.compile(r"^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--template",
        required=True,
        type=Path,
        help="scripts/kiro-power.template.json (or a compatible file) to use as the base for every field other than version.",
    )
    parser.add_argument(
        "--version-file",
        required=True,
        type=Path,
        help="Path to the repo's root VERSION file",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Where to write the rendered plugin.json",
    )
    args = parser.parse_args()

    if not args.template.is_file():
        print(f"error: template not found: {args.template}", file=sys.stderr)
        return 1
    if not args.version_file.is_file():
        print(f"error: VERSION file not found: {args.version_file}", file=sys.stderr)
        return 1

    plugin = json.loads(args.template.read_text(encoding="utf-8"))

    version = args.version_file.read_text(encoding="utf-8").strip()
    if not version:
        print(f"error: {args.version_file} is empty", file=sys.stderr)
        return 1
    plugin["version"] = version

    name = plugin.get("name", "")
    if not _NAME_PATTERN.match(name):
        print(
            f"error: template's 'name' field ({name!r}) does not match the Agent "
            "Plugins v1.0.0 name pattern (lowercase letters/digits/./-, no "
            "leading/trailing separator, no '--' or '..')",
            file=sys.stderr,
        )
        return 1

    if plugin.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json":
        print(
            "error: template's '$schema' field must be exactly "
            "'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'",
            file=sys.stderr,
        )
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plugin, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
