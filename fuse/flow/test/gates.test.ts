// SPDX-License-Identifier: Apache-2.0
// Gates: steps that wait for the owner, steps closed by a check command, and
// steps that block after too many refused attempts.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const GATED = `version: 1
name: gated
max_fix_cycles: 2
steps:
  - id: design
    instruction: Write the design.
    produces: [design.md]
    gate: owner
  - id: build
    instruction: Make the tests pass.
    gate: "check: test -f tests.pass"
  - id: release
    instruction: Release it.
`;

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  repo.start("feat", GATED);
});
afterEach(() => repo.cleanup());

function approveDesign() {
  repo.write("design.md");
  repo.ok("continue", "feat");
  repo.ok("continue", "feat", "--owner-approved");
}

test("an owner gate holds the step until the owner approves it", () => {
  repo.write("design.md");
  const recorded = repo.ok("continue", "feat");
  expect(recorded).toContain("design now awaits owner approval");
  expect(recorded).toContain("step: design awaits owner approval");
  expect(recorded).toContain("ask the owner to review: design.md");
  expect(recorded).toContain("run: fuse-flow continue feat --owner-approved");
  expect(repo.status("feat", "design")).toBe("awaiting-owner");

  // Without the owner's word the workstream does not move.
  expect(repo.refused("continue", "feat")).toContain(
    'step "design" is awaiting-owner; only the owner can move it on, with continue --owner-approved',
  );
  expect(repo.ok("start", "feat")).toContain("step: design awaits owner approval");

  const approved = repo.ok("continue", "feat", "--owner-approved", "--note", "looks good");
  expect(approved).toStartWith("design: owner approved; step done\n\nstep: build\n");
  expect(repo.status("feat", "design")).toBe("done");
  expect(repo.state("feat").steps.design.history.at(-1)).toContain("owner approved: looks good");
});

test("--owner-approved is a flag with no value, and --note and --artifact each belong to one form", () => {
  repo.write("design.md");
  repo.ok("continue", "feat");
  expect(repo.usage("continue", "feat", "--owner-approved=false")).toContain("error:");
  expect(repo.usage("continue", "feat", "--owner-approved", "yes")).toContain("continue takes <slug>");
  expect(repo.usage("continue", "feat", "--note", "x")).toContain("--note goes with --owner-approved");
  expect(repo.usage("continue", "feat", "--owner-approved", "--artifact", "a")).toContain("--artifact records the agent's work");
  expect(repo.status("feat", "design")).toBe("awaiting-owner");
});

test("--owner-approved is refused for a step the agent has not finished", () => {
  expect(repo.refused("continue", "feat", "--owner-approved")).toContain(
    'step "design" is pending, not awaiting the owner; finish it and run continue without --owner-approved',
  );
  expect(repo.state("feat").steps.design.fix_cycles).toBe(0);
});

test("a check gate closes the step only when its command exits 0", () => {
  approveDesign();
  const failed = repo.refused("continue", "feat");
  expect(failed).toContain("check failed (exit 1): test -f tests.pass");
  expect(failed).toContain("fix cycles used on build: 1 of 2");
  expect(repo.status("feat", "build")).toBe("pending");

  repo.write("tests.pass");
  const passed = repo.ok("continue", "feat");
  expect(passed).toContain("build done");
  expect(passed).toContain("step: release");
});

test("a check runs from the repository root, knows its step, and shows the end of its output", () => {
  const repo2 = new Repo();
  try {
    repo2.start(
      "env",
      `version: 1
name: env
steps:
  - id: probe
    instruction: x
    gate: "check: test \\"$FUSE_FLOW_SLUG/$FUSE_FLOW_STEP\\" = env/probe && test -f workflow-source.yml && seq 1 100 && exit 7"
`,
    );
    const out = repo2.refused("continue", "env");
    expect(out).toContain("check failed (exit 7)");
    expect(out).toContain("\n81\n");
    expect(out).toContain("\n100\n");
    expect(out).not.toContain("\n80\n");
  } finally {
    repo2.cleanup();
  }
});

test("a step blocks after max_fix_cycles refused attempts, and the owner can accept it as it is", () => {
  approveDesign();
  repo.refused("continue", "feat");
  const blocked = repo.refused("continue", "feat");
  expect(blocked).toContain("fix cycles used on build: 2 of 2 (the step is now blocked)");
  expect(repo.status("feat", "build")).toBe("blocked");

  // Once blocked, more attempts are refused without counting, even if the check would pass now.
  repo.write("tests.pass");
  expect(repo.refused("continue", "feat")).toContain('step "build" is blocked; only the owner can move it on');
  expect(repo.state("feat").steps.build.fix_cycles).toBe(2);

  const resumed = repo.ok("start", "feat");
  expect(resumed).toContain("step: build is blocked after 2 refused attempts");
  expect(resumed).toContain("continue refused: check failed (exit 1)");
  expect(resumed).toContain("run: fuse-flow continue feat --owner-approved");

  const accepted = repo.ok("continue", "feat", "--owner-approved", "--note", "flaky test, accepted");
  expect(repo.status("feat", "build")).toBe("done");
  expect(accepted).toContain("step: release");
});

test("a step's own max_fix_cycles overrides the workflow's", () => {
  const other = new Repo();
  try {
    other.start(
      "feat",
      `version: 1
name: w
max_fix_cycles: 2
steps:
  - id: build
    instruction: Make the tests pass.
    gate: "check: false"
    max_fix_cycles: 3
  - id: docs
    instruction: Write the docs.
    produces: [docs.md]
    max_fix_cycles: 1
`,
    );
    other.refused("continue", "feat");
    expect(other.refused("continue", "feat")).toContain("fix cycles used on build: 2 of 3");
    expect(other.status("feat", "build")).toBe("pending");
    expect(other.refused("continue", "feat")).toContain("fix cycles used on build: 3 of 3 (the step is now blocked)");
    expect(other.status("feat", "build")).toBe("blocked");

    other.ok("continue", "feat", "--owner-approved", "--note", "accepted as it is");
    expect(other.refused("continue", "feat")).toContain("fix cycles used on docs: 1 of 1 (the step is now blocked)");
    expect(other.status("feat", "docs")).toBe("blocked");
  } finally {
    other.cleanup();
  }
});

test("continue still succeeds and prints the next step when its check changes the workflow file", () => {
  const other = new Repo();
  try {
    other.start("feat", "version: 1\nname: w\nsteps:\n  - id: a\n    instruction: a\n    gate: \"check: rm workflow-source.yml\"\n  - id: b\n    instruction: b\n");
    expect(other.ok("continue", "feat")).toContain("step: b");
    expect(other.status("feat", "a")).toBe("done");
  } finally {
    other.cleanup();
  }
});

test("two continue commands at once record the step once, without costing a fix cycle", async () => {
  const same = new Repo();
  try {
    same.start("feat", "version: 1\nname: same\nsteps:\n  - id: build\n    instruction: x\n    gate: \"check: sleep 1\"\n");
    const results = await Promise.all([same.runInBackground(["continue", "feat"]), same.runInBackground(["continue", "feat"])]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.code === 1)?.out).toContain('step "build" is done now; run continue again');
    expect(same.state("feat").steps.build).toMatchObject({ status: "done", fix_cycles: 0 });
  } finally {
    same.cleanup();
  }
});
