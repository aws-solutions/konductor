// SPDX-License-Identifier: Apache-2.0
// Step order: steps are handed out one at a time, in file order. depends_on
// documents what a step builds on and is checked, but does not change the order.

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
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("steps run in file order, whatever depends_on says", () => {
  expect(repo.start("feat", BRANCHING)).toContain("step: analysis");
  expect(repo.ok("continue", "feat")).toContain("step: requirements");
  expect(repo.ok("continue", "feat")).toContain("step: requirements awaits owner approval");
  expect(repo.ok("continue", "feat", "--owner-approved")).toContain("step: design");
  expect(repo.ok("continue", "feat")).toContain("step: summary");
  expect(repo.ok("continue", "feat")).toEndWith("workflow complete\n");
});
