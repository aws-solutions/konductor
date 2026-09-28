// SPDX-License-Identifier: Apache-2.0
// depends_on: independent steps, and a step that waits for several others.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

// analysis and requirements do not depend on each other; design needs both.
const BRANCHING = `version: 1
name: branching
steps:
  - id: analysis
    instruction: Map the code.
    depends_on: []
  - id: requirements
    instruction: Write the stories.
    gate: owner
    depends_on: []
  - id: design
    instruction: Design it.
    depends_on: [analysis, requirements]
  - id: summary
    instruction: Summarize.
`;

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  repo.start("feat", BRANCHING);
});
afterEach(() => repo.cleanup());

test("next offers the first step in file order whose dependencies are done", () => {
  expect(repo.ok("next", "feat")).toContain("step: analysis");
  repo.ok("done", "feat", "analysis");
  expect(repo.ok("next", "feat")).toContain("step: requirements");
});

test("independent steps can be done in any order", () => {
  repo.ok("done", "feat", "requirements");
  expect(repo.status("feat", "requirements")).toBe("awaiting-owner");
  // requirements awaits the owner, but analysis does not depend on it.
  repo.ok("done", "feat", "analysis");
  expect(repo.status("feat", "analysis")).toBe("done");
});

test("a step that waits for several steps runs only after all of them are done", () => {
  repo.ok("done", "feat", "analysis");
  expect(repo.refused("done", "feat", "design")).toContain('step "design" waits on: requirements');
  repo.ok("done", "feat", "requirements");
  expect(repo.ok("next", "feat")).toContain("step: requirements awaits owner approval");
  expect(repo.ok("status", "feat")).toContain("waits on requirements");

  repo.ok("gate", "feat", "requirements", "--owner-approved");
  expect(repo.ok("next", "feat")).toContain("step: design");
  repo.ok("done", "feat", "design");
  repo.ok("done", "feat", "summary");
  expect(repo.ok("next", "feat")).toBe("workflow complete\n");
});

test("independent steps can be finished at the same time, while a slow check runs", async () => {
  const both = new Repo();
  try {
    both.start(
      "feat",
      `version: 1
name: overlap
steps:
  - id: slow
    instruction: x
    gate: "check: touch check-started && sleep 1"
  - id: fast
    instruction: y
    depends_on: []
`,
    );
    const slow = both.runInBackground(["done", "feat", "slow"]);
    while (!(await Bun.file(`${both.root}/check-started`).exists())) await Bun.sleep(10);
    both.ok("done", "feat", "fast");
    expect((await slow).code).toBe(0);
    expect(both.status("feat", "slow")).toBe("done");
    expect(both.status("feat", "fast")).toBe("done");
  } finally {
    both.cleanup();
  }
});

test("two done commands for the same step at once record it once, without costing a fix cycle", async () => {
  const same = new Repo();
  try {
    same.start("feat", "version: 1\nname: same\nsteps:\n  - id: build\n    instruction: x\n    gate: \"check: sleep 1\"\n");
    const results = await Promise.all([same.runInBackground(["done", "feat", "build"]), same.runInBackground(["done", "feat", "build"])]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.code === 1)?.out).toContain('step "build" is done, not pending');
    expect(same.state("feat").steps.build).toMatchObject({ status: "done", fix_cycles: 0 });
  } finally {
    same.cleanup();
  }
});
