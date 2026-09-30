#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# check-plugin-json-version-drift.sh -- fails closed if the checked-in
# powers/konductor/plugin.json's own "version" field has drifted from the
# repo-root VERSION file (adversarial-review finding I5).
#
# Why both copies exist at all: VERSION is this repo's single source of
# truth for the released version (Cargo.toml, the packaged tarball name,
# and this script all key off it). powers/konductor/plugin.json is the
# Kiro Power's own manifest -- users import the Power straight from
# github.com/aws-solutions/konductor/tree/main/powers/konductor, so this
# checked-in file IS the published artifact directly, not a convenience
# mirror of some separately-assembled copy. It is ALSO what
# resolve-version.sh's resolve_plugin_version() reads: it walks upward
# from powers/konductor/skills/konductor-setup/scripts/ looking for a
# sibling plugin.json, and finds this exact file, so a stale version here
# would make run-onboarding.sh (and any test exercising tag resolution)
# resolve the wrong tag against a real git checkout -- the same failure
# mode an end user importing the Power from GitHub would also hit.
#
# This script is what keeps that fact from ever silently drifting: a
# version bump to one file without the other is a hard, loud failure here,
# not a Power whose plugin.json quietly claims a version VERSION itself
# disagrees with. Re-render powers/konductor/plugin.json with `make
# kiro-power` after bumping VERSION, then commit both together.
#
# Wired into `make kiro-power-check` as a
# pre-check, run before the rest of that target's validation steps.
#
# Usage: check-plugin-json-version-drift.sh
# Exits 0 if the two agree; exits 1 with both values named if they don't.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${REPO_ROOT}/VERSION"
PLUGIN_JSON="${REPO_ROOT}/powers/konductor/plugin.json"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "error: [check-plugin-json-version-drift] ${VERSION_FILE} not found" >&2
  exit 1
fi
if [[ ! -f "$PLUGIN_JSON" ]]; then
  echo "error: [check-plugin-json-version-drift] ${PLUGIN_JSON} not found" >&2
  exit 1
fi

VERSION_VALUE="$(tr -d '[:space:]' < "$VERSION_FILE")"
PLUGIN_JSON_VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$PLUGIN_JSON")"

if [[ "$VERSION_VALUE" != "$PLUGIN_JSON_VERSION" ]]; then
  echo "error: [check-plugin-json-version-drift] VERSION says '${VERSION_VALUE}' but ${PLUGIN_JSON} says '${PLUGIN_JSON_VERSION}' -- these must always match. Run 'make kiro-power' to re-render powers/konductor/plugin.json from VERSION, then commit both together (this file is the Power's published manifest directly -- users import it from github.com/aws-solutions/konductor/tree/main/powers/konductor, so a drifted version here ships to them, not just to direct-from-dev-tree runs and tests)." >&2
  exit 1
fi

echo "=== [check-plugin-json-version-drift] OK -- VERSION and powers/konductor/plugin.json both say ${VERSION_VALUE} ==="
