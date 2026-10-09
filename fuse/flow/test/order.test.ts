// SPDX-License-Identifier: Apache-2.0
// Inputs: a step reads what earlier steps produced or updated,
// and the step block says whether each input exists. Steps still run one at a
// time, in file order.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const FLOW = `version: 1
name: inputs
steps:
  - id: analysis
    instruction: Map the code.
    produces:
      - artifact: map
        path: docs/{slug}/map.md
  - id: stories
    instruction: Write the stories.
    produces:
      - artifact: stories
        path: docs/{slug}/stories.md
  - id: design
    instruction: Design it.
    consumes: [map, stories]
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("a step lists what it consumes, with {slug} resolved, from the step that produced it", () => {
  repo.start("feat", FLOW);
  expect(repo.start("feat", FLOW)).toContain("PRODUCE docs/feat/map.md (map).");
  repo.write("docs/feat/map.md");
  repo.ok("continue", "feat");
  repo.write("docs/feat/stories.md");
  const out = repo.ok("continue", "feat");
  expect(out).toContain("STEP design (3 of 3): Design it.\nREAD docs/feat/map.md (from step analysis).\nREAD docs/feat/stories.md (from step stories).\n");
});

test("a missing input is reported with what to do about it, never refused", () => {
  repo.ok("start", "feat", "--workflow", repo.write("wf.yml", FLOW), "--from", "design");
  const out = repo.ok("start", "feat");
  expect(out).toContain("READ docs/feat/map.md (from step analysis). It does not exist");
  expect(out).toContain("report what you did in the hand-over block");
  expect(repo.ok("continue", "feat")).toContain("STATUS: workflow complete");
});

test("validate refuses an input that no earlier step produces or updates", () => {
  const bad = FLOW.replace("consumes: [map, stories]", "consumes: [map, tests]").replace(
    "  - id: analysis",
    "  - id: early\n    instruction: Read the design first.\n    consumes: [design-doc]\n  - id: analysis",
  );
  const out = repo.refused("validate", repo.write("bad.yml", bad));
  expect(out).toContain('"early" consumes "design-doc", which no step before it produces or updates');
  expect(out).toContain('"design" consumes "tests", which no step before it produces or updates');
});

test("{date} in an artifact path is the day the workstream started, for the whole workstream", () => {
  const dated = FLOW.replaceAll("docs/{slug}/", "docs/{date}-{slug}/");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  expect(repo.start("feat", dated)).toContain(`PRODUCE docs/${today}-feat/map.md (map).`);
  expect(repo.state("feat").started).toBe(today);

  // A workstream started on another day keeps that day's paths.
  const file = ".konductor/workstreams/feat.yml";
  repo.write(file, repo.read(file).replace(`started: ${today}`, "started: 2026-01-31"));
  expect(repo.ok("start", "feat")).toContain("PRODUCE docs/2026-01-31-feat/map.md (map).");

  // A state file from before `started` existed uses its earliest history line.
  const legacy = repo.read(file).replace("started: 2026-01-31\n", "").replace(/history:\n(\s+)- \S+/, "history:\n$1- 2025-12-24T12:00:00.000Z");
  repo.write(file, legacy);
  expect(repo.ok("start", "feat")).toContain("PRODUCE docs/2025-12-24-feat/map.md (map).");
});
