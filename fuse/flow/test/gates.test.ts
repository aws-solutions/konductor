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
  repo.ok("done", "feat", "design");
  repo.ok("gate", "feat", "design", "--owner-approved");
}

test("an owner gate holds the step until the owner approves it", () => {
  repo.write("design.md");
  const recorded = repo.ok("done", "feat", "design");
  expect(recorded).toContain("design now awaits owner approval");
  expect(recorded).toContain("step: design awaits owner approval");
  expect(repo.status("feat", "design")).toBe("awaiting-owner");

  const waiting = repo.ok("next", "feat");
  expect(waiting).toContain("step: design awaits owner approval");
  expect(waiting).toContain("ask the owner to review: design.md");
  expect(waiting).toContain("run: fuse-flow gate feat design --owner-approved");
  expect(repo.refused("done", "feat", "build")).toContain('step "build" waits on: design');

  const approved = repo.ok("gate", "feat", "design", "--owner-approved", "--note", "looks good");
  expect(approved).toStartWith("design: owner approved; step done\n\nstep: build\n");
  expect(repo.status("feat", "design")).toBe("done");
  expect(repo.state("feat").steps.design.history.at(-1)).toContain("owner approved: looks good");
  expect(repo.ok("next", "feat")).toContain("step: build");
});

test("gate needs the explicit --owner-approved flag, with no value", () => {
  repo.write("design.md");
  repo.ok("done", "feat", "design");
  expect(repo.usage("gate", "feat", "design")).toContain("pass --owner-approved");
  expect(repo.usage("gate", "feat", "design", "--owner-approved=false")).toContain("error:");
  expect(repo.usage("gate", "feat", "design", "--owner-approved", "yes")).toContain("gate takes <slug> <step>");
  expect(repo.status("feat", "design")).toBe("awaiting-owner");
});

test("gate is refused for a step that does not wait for the owner", () => {
  expect(repo.refused("gate", "feat", "design", "--owner-approved")).toContain(
    'step "design" is pending; only a step awaiting the owner or blocked can be approved',
  );
});

test("a check gate closes the step only when its command exits 0", () => {
  approveDesign();
  const failed = repo.refused("done", "feat", "build");
  expect(failed).toContain("check failed (exit 1): test -f tests.pass");
  expect(failed).toContain("fix cycles used on build: 1 of 2");
  expect(repo.status("feat", "build")).toBe("pending");

  repo.write("tests.pass");
  expect(repo.ok("done", "feat", "build")).toContain("build done");
  expect(repo.ok("next", "feat")).toContain("step: release");
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
    const out = repo2.refused("done", "env", "probe");
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
  repo.refused("done", "feat", "build");
  expect(repo.refused("done", "feat", "build")).toContain("fix cycles used on build: 2 of 2 (the step is now blocked)");
  expect(repo.status("feat", "build")).toBe("blocked");

  // Once blocked, more attempts are refused without counting.
  repo.write("tests.pass");
  expect(repo.refused("done", "feat", "build")).toContain('step "build" is blocked, not pending');
  expect(repo.state("feat").steps.build.fix_cycles).toBe(2);

  const blocked = repo.ok("next", "feat");
  expect(blocked).toContain("step: build is blocked after 2 refused attempts");
  expect(blocked).toContain("done refused: check failed (exit 1)");
  expect(blocked).toContain("run: fuse-flow gate feat build --owner-approved");

  repo.ok("gate", "feat", "build", "--owner-approved", "--note", "flaky test, accepted");
  expect(repo.status("feat", "build")).toBe("done");
  expect(repo.ok("next", "feat")).toContain("step: release");
});

test("done still succeeds and prints the next step when its check changes the workflow file", () => {
  const other = new Repo();
  try {
    other.start("feat", "version: 1\nname: w\nsteps:\n  - id: a\n    instruction: a\n    gate: \"check: rm workflow-source.yml\"\n  - id: b\n    instruction: b\n");
    expect(other.ok("done", "feat", "a")).toContain("step: b");
    expect(other.status("feat", "a")).toBe("done");
  } finally {
    other.cleanup();
  }
});
