// SPDX-License-Identifier: Apache-2.0
// Mistakes on the command line, and state that is missing, broken or locked.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { Repo } from "./helpers";

const WORKFLOW = `version: 1
name: w
steps:
  - id: only
    instruction: x
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("help prints the usage", () => {
  expect(repo.ok("help")).toContain("usage:");
});

test("usage errors exit 64 and print the usage", () => {
  expect(repo.usage()).toContain("error: no command");
  expect(repo.usage("launch", "feat")).toContain('error: unknown command "launch"');
  expect(repo.usage("constructor", "feat")).toContain('error: unknown command "constructor"');
  expect(repo.usage("continue")).toContain("error: continue takes <slug>");
  expect(repo.usage("continue", "feat", "only")).toContain("error: continue takes <slug>");
  expect(repo.usage("status", "My_Feature")).toContain('slug "My_Feature" must be lowercase letters, digits and hyphens');
  expect(repo.usage("status", "feat", "--verbose")).toContain("--verbose");
  expect(repo.usage("start", "feat", "--workflow")).toContain("--workflow");
  expect(repo.usage("start", "feat", "--workflow=")).toContain("--workflow needs a value");
  expect(repo.usage("continue", "feat", "--artifact=")).toContain("--artifact needs a value");
});

test("a command on a workstream that was never started says to start it", () => {
  repo.start("feat", WORKFLOW);
  expect(repo.refused("continue", "other")).toContain("run fuse-flow start other first");
});

test("a state file that fuse-flow did not write is refused, not overwritten", () => {
  repo.start("feat", WORKFLOW);
  const edited = "steps:\n  only:\n    status: finished\n";
  repo.write(".konductor/workstreams/feat.yml", edited);
  expect(repo.refused("continue", "feat")).toContain("is not a valid workstream file");
  expect(repo.read(".konductor/workstreams/feat.yml")).toBe(edited);
});

test("a state directory fuse-flow cannot write to is reported, not a crash", () => {
  repo.start("feat", WORKFLOW);
  chmodSync(join(repo.root, ".konductor/workstreams"), 0o555);
  try {
    const out = repo.refused("continue", "feat");
    expect(out).toContain("error: EACCES");
    expect(out).toContain("feat.yml.lock");
  } finally {
    chmodSync(join(repo.root, ".konductor/workstreams"), 0o755);
  }
});

test("a command waits for another process's lock, and names the file if it never goes away", () => {
  repo.start("feat", WORKFLOW);
  repo.write(".konductor/workstreams/feat.yml.lock", "12345\n");
  const out = repo.refused("continue", "feat");
  expect(out).toContain("another fuse-flow process holds");
  expect(out).toContain("feat.yml.lock; if none is running, delete that file");
  expect(repo.status("feat", "only")).toBe("pending");
});
