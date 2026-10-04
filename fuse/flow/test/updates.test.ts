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
    '--unchanged names an artifact the step updates, by its id or its path; "readme" is neither (patch (src/), changelog (CHANGELOG.md))',
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

test("a file outside the repository is accepted but accounts for no artifact", () => {
  repo.start("feat", CHANGE.replace("path: src/", "path: ."));
  const outside = `${repo.root}-outside.txt`;
  expect(repo.refused("continue", "feat", "--updated", outside, "--unchanged", "changelog", "x")).toContain("REFUSED: not accounted for: patch (.)");
  const out = repo.ok("continue", "feat", "--updated", outside, "--updated", "src/a.ts", "--unchanged", "changelog", "x");
  expect(out).toContain(`PRODUCED: ${outside} (updated, outside the declared paths); src/a.ts (updated);`);
});

test("the workflow-complete hand-over gathers what every step produced and verified", () => {
  const flow = CHANGE.replace("      - owner-action: approve the change\n", "      - script: \"true\"\n") + "  - id: notes\n    instruction: Write notes.\n    produces:\n      - artifact: notes\n        path: notes.md\n";
  repo.start("feat", flow);
  repo.ok("continue", "feat", "--updated", "src/a.ts", "--unchanged", "changelog", "nothing user-facing");
  const out = repo.ok("continue", "feat", "--not-produced", "notes", "no notes needed");
  expect(out).toContain("PRODUCED: change: src/a.ts (updated); changelog unchanged (nothing user-facing); notes: notes not produced (no notes needed)\n");
  expect(out).toContain("VERIFICATION: change: script `true`: passed\n");
});

test("--unchanged and --not-produced also name an artifact by its path, as the step block shows it", () => {
  const flow =
    CHANGE.replace("path: src/", "path: .").replace("      - owner-action: approve the change\n", "      - script: \"true\"\n") +
    "  - id: notes\n    instruction: Write notes.\n    produces:\n      - artifact: notes\n        path: docs/notes.md\n";
  repo.start("feat", flow);
  // "." is the repository root, given from a subdirectory as "..".
  const r = repo.run(["continue", "feat", "--unchanged", "..", "no code change", "--unchanged", "../CHANGELOG.md", "nothing user-facing"], `${repo.root}/src`);
  expect(r.out).toContain("change: COMPLETED\n");
  expect(repo.state("feat").steps.change.unchanged).toEqual({ patch: "no code change", changelog: "nothing user-facing" });

  expect(repo.refused("continue", "feat", "--not-produced", "notes.md", "x")).toContain(
    '--not-produced names an artifact the step produces, by its id or its path; "notes.md" is neither (notes (docs/notes.md))',
  );
  expect(repo.ok("continue", "feat", "--not-produced", "./docs/notes.md", "no notes needed")).toContain("notes not produced (no notes needed)");
});

test("a path that two artifacts share is refused, and the artifact must be named by its id", () => {
  repo.start("feat", CHANGE.replace("path: CHANGELOG.md", "path: src/"));
  expect(repo.refused("continue", "feat", "--unchanged", "src", "x")).toContain('--unchanged "src" is the path of patch and changelog; name the artifact by its id');
  expect(repo.ok("continue", "feat", "--unchanged", "patch", "x", "--unchanged", "changelog", "y")).toContain("STATUS: awaiting owner action.");
});
