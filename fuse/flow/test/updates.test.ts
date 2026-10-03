// SPDX-License-Identifier: Apache-2.0
// Updates: a step that changes existing artifacts, such as code, accounts for
// each of them on continue (decision 43), and the hand-over block lists what
// it changed.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const CHANGE = `version: 1
name: change
steps:
  - id: change
    instruction: Make the change.
    updates:
      - artifact: patch
        path: src/
      - artifact: changelog
        path: CHANGELOG.md
    gates:
      - owner-action: approve the change
`;

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  repo.write("src/a.ts");
  repo.write("CHANGELOG.md");
});
afterEach(() => repo.cleanup());

test("continue is refused until every updates artifact is reported as updated or unchanged", () => {
  const block = repo.start("feat", CHANGE);
  expect(block).toContain("UPDATE src/ (patch).\nUPDATE CHANGELOG.md (changelog).\n");
  expect(block).toContain(
    '--unchanged <artifact> "<reason>" for each of patch, changelog that you left as it was. The step then waits for the owner to approve the change.',
  );

  expect(repo.refused("continue", "feat")).toContain(
    "REFUSED: not accounted for: patch (src/), changelog (CHANGELOG.md). Report each file you revised with --updated <file>",
  );
  expect(repo.refused("continue", "feat", "--updated", "src/a.ts")).toContain("REFUSED: not accounted for: changelog (CHANGELOG.md).");
  expect(repo.refused("continue", "feat", "--unchanged", "readme", "x")).toContain(
    '--unchanged names an artifact the step updates; "readme" is not one (patch, changelog)',
  );

  const out = repo.ok("continue", "feat", "--updated", "src/a.ts", "--updated", "docs/extra.md", "--unchanged", "changelog", "nothing user-facing");
  expect(out).toContain(
    "PRODUCED: src/a.ts (updated); docs/extra.md (updated, outside the declared paths); changelog unchanged (nothing user-facing)\n",
  );
  const state = repo.state("feat").steps.change;
  expect(state.updated).toEqual(["src/a.ts", "docs/extra.md"]);
  expect(state.unchanged).toEqual({ changelog: "nothing user-facing" });
});

test("a missing updates path is reported when the step is handed out, not refused (decision 45)", () => {
  repo.cleanupPath("CHANGELOG.md");
  expect(repo.start("feat", CHANGE)).toContain("UPDATE CHANGELOG.md (changelog). CHANGELOG.md does not exist yet; create it and report it with --updated.");
  repo.write("CHANGELOG.md");
  expect(repo.ok("continue", "feat", "--updated", "CHANGELOG.md", "--unchanged", "patch", "docs only")).toContain("STATUS: awaiting owner action.");
});

test("--updated paths are relative to the current directory, and five or more files are summarized", () => {
  repo.start("feat", CHANGE);
  const files = ["a", "b", "c", "d", "e"].map((n) => `src/checkout/${n}.ts`);
  for (const f of files) repo.write(f);
  const r = repo.run(["continue", "feat", ...files.flatMap((f) => ["--updated", f.replace("src/", "")]), "--unchanged", "changelog", "x"], `${repo.root}/src`);
  expect(r.code).toBe(0);
  expect(r.out).toContain('PRODUCED: 5 files under src/checkout/; summarize them, for example "12 files under src/checkout/, with their tests"; changelog unchanged (x)');
  expect(repo.state("feat").steps.change.updated).toEqual(files);
});

test("--updated, --unchanged and --not-produced report the agent's work, so no owner decision goes with them", () => {
  repo.start("feat", CHANGE);
  expect(repo.usage("continue", "feat", "--unchanged", "patch", "x", "--owner-approved")).toContain(
    "--unchanged reports the agent's work; it does not go with --owner-approved",
  );
  expect(repo.usage("continue", "feat", "--not-produced", "patch", "x", "--skip", "y")).toContain("--not-produced reports the agent's work");
});

test("an updates artifact whose path is the repository root contains every file in it", () => {
  repo.start("feat", CHANGE.replace("path: src/", "path: ."));
  expect(repo.ok("continue", "feat", "--updated", "src/a.ts", "--unchanged", "changelog", "x")).toContain("PRODUCED: src/a.ts (updated);");
});
