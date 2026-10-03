// SPDX-License-Identifier: Apache-2.0
// Gates: steps that wait for the owner, steps closed by a check command,
// agent gates and their round cap, and steps the agent reports as blocked.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const GATED = `version: 1
name: gated
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
  expect(recorded).toContain("ask the owner to: approve");
  expect(recorded).toContain("artifacts: design.md");
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
  expect(repo.state("feat").steps.design.history).toEqual([]);
});

test("a check gate closes the step only when its command exits 0", () => {
  approveDesign();
  const failed = repo.refused("continue", "feat");
  expect(failed).toContain("script failed (exit 1): test -f tests.pass");
  expect(repo.status("feat", "build")).toBe("pending");
  expect(repo.state("feat").steps.build.history.at(-1)).toContain("continue refused: script failed (exit 1)");

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
    expect(out).toContain("script failed (exit 7)");
    expect(out).toContain("\n81\n");
    expect(out).toContain("\n100\n");
    expect(out).not.toContain("\n80\n");
  } finally {
    repo2.cleanup();
  }
});

test("failed checks never block a step; the agent reports it blocked, and the owner can accept it as it is", () => {
  approveDesign();
  for (let i = 0; i < 4; i++) repo.refused("continue", "feat");
  expect(repo.status("feat", "build")).toBe("pending");

  const blocked = repo.ok("continue", "feat", "--blocked", "the test needs a database this host does not have");
  expect(blocked).toStartWith("build blocked: the test needs a database this host does not have\n\nstep: build is blocked\n");
  expect(repo.status("feat", "build")).toBe("blocked");

  // Once blocked, only the owner moves it on, even if the check would pass now.
  repo.write("tests.pass");
  expect(repo.refused("continue", "feat")).toContain('step "build" is blocked; only the owner can move it on');
  expect(repo.refused("continue", "feat", "--blocked", "again")).toContain('step "build" is blocked; only the owner can move it on');

  const resumed = repo.ok("start", "feat");
  expect(resumed).toContain("step: build is blocked");
  expect(resumed).toContain("blocked by the agent: the test needs a database this host does not have");
  expect(resumed).toContain(`accept the step as it is:     fuse-flow continue feat --owner-approved --note "<the owner's decision>"`);
  expect(resumed).toContain("  send the work back to a step:\n    fuse-flow continue feat --back-to <step>");
  expect(resumed).toContain("to rework an artifact, send the work back to the step that produces it: design: design.md; build");
  // build has no agent gate, so there are no review rounds to grant, and no gate suggests a step.
  expect(resumed).not.toContain("--more-rounds");
  expect(resumed).not.toContain("suggested by the step's gates");
  expect(repo.refused("continue", "feat", "--more-rounds", "1")).toContain('step "build" has no agent gate');

  const accepted = repo.ok("continue", "feat", "--owner-approved", "--note", "accepted without the database test");
  expect(repo.status("feat", "build")).toBe("done");
  expect(accepted).toContain("step: release");
});

test("an agent gate prints its round cap, 2 unless it sets max_rounds, and how to report the step blocked", () => {
  const other = new Repo();
  try {
    other.start(
      "feat",
      `version: 1
name: w
steps:
  - id: review
    instruction: Review the change.
    gates:
      - agent: review the diff against the spec
        max_rounds: 3
      - agent("check the docs")
`,
    );
    const out = other.ok("start", "feat");
    expect(out).toContain(
      "agent gate: before continuing, have an agent review the diff against the spec. Consider each finding " +
        "critically and classify it as fix required or false positive, with the reason; a finding the owner already " +
        "accepted or deferred is not a required fix. Fix what is required and review again, until a round ends with " +
        "no required fix. Every round that ends with a required fix counts, whatever the cause: you and the reviewer " +
        "disagree, the reviewer finds new problems each round, or a fix introduced a regression. After 3 " +
        'such rounds, do not start another; run: fuse-flow continue feat --blocked "<what is still open, and why the ' +
        'review does not converge>"',
    );
    expect(out).toContain("have an agent check the docs. Consider each finding critically");
    expect(out).toContain("After 2 such rounds, do not start another");
  } finally {
    other.cleanup();
  }
});

const REVIEWED = `version: 1
name: reviewed
steps:
  - id: spec
    instruction: Write the spec.
    produces: [spec.md]
  - id: implement
    instruction: Implement the spec.
    gates:
      - agent: review the diff against the spec
        route_back_to: [spec, implement]
  - id: release
    instruction: Release it.
`;

test("the owner can grant a blocked step more review rounds, and the agent gate prints the raised cap", () => {
  const other = new Repo();
  try {
    other.start("feat", REVIEWED);
    other.write("spec.md");
    other.ok("continue", "feat");
    expect(other.ok("start", "feat")).toContain("After 2 such rounds, do not start another");

    const blocked = other.ok("continue", "feat", "--blocked", "the reviewer wants an API the spec rules out");
    expect(blocked).toContain("grant more review rounds:     fuse-flow continue feat --more-rounds <n>");
    expect(blocked).toContain("suggested by the step's gates: spec, implement");
    expect(other.refused("continue", "feat")).toContain('step "implement" is blocked');

    const granted = other.ok("continue", "feat", "--more-rounds", "1", "--note", "one more, then I decide");
    expect(granted).toStartWith("implement: owner granted 1 more review round; step pending again\n\nstep: implement\n");
    expect(granted).toContain("After 3 (2 plus 1 granted by the owner) such rounds, do not start another");
    expect(other.status("feat", "implement")).toBe("pending");
    expect(other.state("feat").steps.implement.history.at(-1)).toContain("owner granted 1 more review round: one more, then I decide");

    other.ok("continue", "feat", "--blocked", "still disagreeing");
    expect(other.ok("continue", "feat", "--more-rounds", "2")).toContain("After 5 (2 plus 3 granted by the owner) such rounds");
    expect(other.ok("continue", "feat")).toContain("step: release");
  } finally {
    other.cleanup();
  }
});

test("the owner can send the work back from a blocked step to it or an earlier step, which starts over", () => {
  const other = new Repo();
  try {
    other.start("feat", REVIEWED);
    other.write("spec.md");
    other.ok("continue", "feat");
    other.ok("continue", "feat", "--blocked", "x");
    other.ok("continue", "feat", "--more-rounds", "1");
    other.ok("continue", "feat", "--blocked", "the spec itself is wrong about the API");

    expect(other.refused("continue", "feat", "--back-to", "release")).toContain('step "release" comes after "implement"');
    expect(other.refused("continue", "feat", "--back-to", "nowhere")).toContain('no step "nowhere" in workflow reviewed');

    const back = other.ok("continue", "feat", "--back-to", "spec", "--note", "fix the API section first");
    expect(back).toStartWith("implement: owner sent the work back to spec\n\nstep: spec\n");
    expect(other.state("feat").steps.spec).toMatchObject({ status: "pending", artifacts: [] });
    expect(other.state("feat").steps.spec.history.at(-1)).toContain("owner sent the work back from implement to spec: fix the API section first");
    expect(other.state("feat").steps.implement.status).toBe("pending");
    expect(other.state("feat").steps.implement.rounds_granted).toBeUndefined();
    // spec.md is still on disk, so the agent can amend it and continue.
    expect(other.ok("continue", "feat")).toContain("After 2 such rounds, do not start another");
  } finally {
    other.cleanup();
  }
});

test("--more-rounds answers a blocked step only, and --back-to also a step that awaits the owner", () => {
  expect(repo.refused("continue", "feat", "--more-rounds", "1")).toContain('step "design" is pending, not blocked');
  expect(repo.refused("continue", "feat", "--back-to", "design")).toContain(
    'step "design" is pending; --back-to answers a step that awaits the owner or is blocked',
  );
  repo.write("design.md");
  repo.ok("continue", "feat");
  expect(repo.refused("continue", "feat", "--more-rounds", "1")).toContain('step "design" is awaiting-owner, not blocked');
});

test("the owner can reject a step that awaits approval and send the work back, as its gates suggest", () => {
  const other = new Repo();
  try {
    other.start(
      "feat",
      `version: 1
name: approved
steps:
  - id: design
    instruction: Write the design.
    produces: [design.md]
  - id: design-review
    instruction: Review the design.
    produces: [review.md]
    gates:
      - owner-action: approve the reviewed design
        route_back_to: design
`,
    );
    other.write("design.md");
    other.ok("continue", "feat");
    other.write("review.md");
    const waiting = other.ok("continue", "feat");
    expect(waiting).toContain("after the owner approves, run: fuse-flow continue feat --owner-approved");
    expect(waiting).toContain("if the owner rejects it instead, send the work back to a step:");
    expect(waiting).toContain("suggested by the step's gates: design");
    expect(waiting).toContain("send the work back to the step that produces it: design: design.md; design-review: review.md");

    const back = other.ok("continue", "feat", "--back-to", "design", "--note", "the data model is wrong");
    expect(back).toStartWith("design-review: owner sent the work back to design\n\nstep: design\n");
    expect(other.status("feat", "design")).toBe("pending");
    expect(other.status("feat", "design-review")).toBe("pending");
    expect(other.state("feat").steps["design-review"].history.at(-1)).toContain(
      "owner sent the work back from design-review to design: the data model is wrong",
    );
  } finally {
    other.cleanup();
  }
});

test("--more-rounds takes a whole number, and each owner decision goes alone", () => {
  expect(repo.usage("continue", "feat", "--more-rounds", "0")).toContain("--more-rounds takes a whole number of rounds, 1 or more");
  expect(repo.usage("continue", "feat", "--more-rounds", "two")).toContain("--more-rounds takes a whole number");
  expect(repo.usage("continue", "feat", "--more-rounds", "1", "--owner-approved")).toContain("--owner-approved and --more-rounds are different decisions");
  expect(repo.usage("continue", "feat", "--back-to", "design", "--artifact", "a")).toContain("--artifact records the agent's work; it does not go with --back-to");
});

test("--blocked needs a reason and goes with no other option", () => {
  expect(repo.usage("continue", "feat", "--blocked")).toContain("--blocked");
  expect(repo.usage("continue", "feat", "--blocked=")).toContain("--blocked needs a value");
  expect(repo.usage("continue", "feat", "--blocked", "x", "--owner-approved")).toContain("--blocked reports that the agent cannot finish the step");
  expect(repo.usage("continue", "feat", "--blocked", "x", "--artifact", "a")).toContain("--blocked reports that the agent cannot finish the step");
  expect(repo.status("feat", "design")).toBe("pending");
});

test("a state file written while fuse-flow counted fix cycles is still read, and the count is dropped", () => {
  const state = repo.read(".konductor/workstreams/feat.yml").replaceAll("status: pending", "status: pending\n    fix_cycles: 1");
  repo.write(".konductor/workstreams/feat.yml", state);
  repo.write("design.md");
  expect(repo.ok("continue", "feat")).toContain("design now awaits owner approval");
  expect(repo.read(".konductor/workstreams/feat.yml")).not.toContain("fix_cycles");
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

test("two continue commands at once record the step once", async () => {
  const same = new Repo();
  try {
    same.start("feat", "version: 1\nname: same\nsteps:\n  - id: build\n    instruction: x\n    gate: \"check: sleep 1\"\n");
    const results = await Promise.all([same.runInBackground(["continue", "feat"]), same.runInBackground(["continue", "feat"])]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.code === 1)?.out).toContain('step "build" is done now; run continue again');
    expect(same.state("feat").steps.build).toMatchObject({ status: "done" });
  } finally {
    same.cleanup();
  }
});
