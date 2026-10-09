// SPDX-License-Identifier: Apache-2.0
// Regression tests for scripts/validate-version-semver.sh.
//
// `grep -qE '^X$'` anchors `^`/`$` to LINE boundaries, not the whole input.
// Since callers derive the version via `$(cat VERSION)` -- which strips only
// the trailing newline, not embedded ones -- a multi-line value whose first
// line is valid semver (e.g. "0.1.0\ngarbage") would satisfy the structural
// grep check on its first line alone. The script guards against this with a
// `case "$VERSION" in *[!0-9.]*)` glob before the structural check: any
// character outside `[0-9.]`, including an embedded newline, fails closed.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "validate-version-semver.sh");

const runValidator = (...args: string[]) => {
  const result = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("validate-version-semver.sh", () => {
  test("the script exists", () => {
    expect(statSync(SCRIPT).isFile()).toBe(true);
  });

  test("valid semver is accepted", () => {
    const result = runValidator("0.1.0");
    expect(result.status, result.stderr).toBe(0);
  });

  test("plain garbage is rejected", () => {
    const result = runValidator("garbage");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not a valid semver");
  });

  // The regression this file exists to pin: a first line that is valid
  // semver must not let a trailing garbage line slip through.
  test("multi-line input with a valid first line is rejected", () => {
    const result = runValidator("0.1.0\ngarbage");
    expect(result.status, `stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`).toBe(1);
    expect(result.stderr).toContain("not a valid semver");
  });

  // Embedded newlines are rejected even when every line looks like semver on
  // its own: the case guard has no notion of "valid lines", only "valid whole
  // string".
  test("multi-line input where every line is valid is still rejected", () => {
    const result = runValidator("0.1.0\n0.2.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not a valid semver");
  });

  test("a missing argument fails closed", () => {
    const result = runValidator();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires a version string argument");
  });
});
