// SPDX-License-Identifier: Apache-2.0
// Gates: steps that wait for the owner, checks bound through policy, literal
// script gates, agent gates and their round cap, steps the agent reports as
// blocked, and the owner's decisions on them.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const GATED = `version: 1
name: gated
steps:
  - id: design
    instruction: Write the design.
    produces:
      - artifact: sketch
        path: design.md
    gates:
      - owner-action: approve the design
  - id: build
    instruction: Make the tests pass.
    gates:
      - script: test -f tests.pass
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

test("an owner gate holds the step and prints the pre-filled hand-over block until the owner approves", () => {
  repo.write("design.md");
  const recorded = repo.ok("continue", "feat");
  expect(recorded).toStartWith("design: work recorded; the step awaits the owner's action\n\nOWNER'S TURN: end your message with this hand-over block.");
  expect(recorded).toContain("SUMMARY: <the task you worked on, in a sentence>. Workstream feat, step design, 1 of 3.\n");
  expect(recorded).toContain("STATUS: awaiting owner action. The owner is asked to approve the design.\n");
  expect(recorded).toContain("PRODUCED: design.md (new)\n");
  expect(recorded).toContain("VERIFICATION: none\n");
  // The owner sees the options in plain words; the commands come after the block, for the agent only.
  expect(recorded).toContain("NEXT STEP:\n  - Approve the design.\n  - Send the work back to an earlier step, with what to change.\n\nFOR YOU, NOT FOR THE OWNER:");
  const block = recorded.slice(0, recorded.indexOf("FOR YOU, NOT FOR THE OWNER:"));
  expect(block.split("\n").filter((l) => /^(SUMMARY|STATUS|PRODUCED|VERIFICATION|NEXT STEP|  - )/.test(l)).join("\n")).not.toContain("fuse-flow");
  expect(recorded).toContain(
    '\n  - The owner does what the step asks (approve the design): run `fuse-flow continue feat --owner-approved --note "<what the owner said>"`.\n',
  );
  expect(recorded).toContain("To rework an artifact, name the step that produces it: design (design.md).");
  expect(repo.status("feat", "design")).toBe("AWAITING_OWNER");
  expect(repo.state("feat").steps.design.artifacts).toEqual([{ artifact: "sketch", path: "design.md", status: "draft" }]);

  // Without the owner's word the workstream does not move.
  expect(repo.refused("continue", "feat")).toContain('step "design" is AWAITING_OWNER; only the owner can move it on');
  expect(repo.ok("start", "feat")).toContain("STATUS: awaiting owner action.");

  const approved = repo.ok("continue", "feat", "--owner-approved", "--note", "looks good");
  expect(approved).toStartWith(
    "design: owner approved; COMPLETED\nIf any of design.md keeps a status of its own, as its guide says, set it to approved.\n\nSTEP build (2 of 3)",
  );
  expect(repo.status("feat", "design")).toBe("COMPLETED");
  expect(repo.state("feat").steps.design.artifacts[0].status).toBe("approved");
  expect(repo.state("feat").steps.design.history.at(-1)).toContain("owner approved: looks good");
});

test("--owner-approved is a flag with no value, and each option belongs to one form", () => {
  repo.write("design.md");
  repo.ok("continue", "feat");
  expect(repo.usage("continue", "feat", "--owner-approved=false")).toContain("error:");
  expect(repo.usage("continue", "feat", "--owner-approved", "yes")).toContain("continue takes <slug>");
  expect(repo.usage("continue", "feat", "--note", "x")).toContain("--note goes with --owner-approved");
  expect(repo.usage("continue", "feat", "--owner-approved", "--updated", "a")).toContain("--updated reports the agent's work; it does not go with --owner-approved");
  expect(repo.status("feat", "design")).toBe("AWAITING_OWNER");
});

test("--owner-approved is refused for a step the agent has not finished", () => {
  expect(repo.refused("continue", "feat", "--owner-approved")).toContain(
    'step "design" is IN_PROGRESS, not awaiting the owner or blocked; finish it and run continue without --owner-approved',
  );
});

test("a script gate closes the step only when its command exits 0", () => {
  approveDesign();
  const failed = repo.refused("continue", "feat");
  expect(failed).toStartWith("REFUSED: script `test -f tests.pass` failed (exit 1)\n\nSTEP build (2 of 3)");
  expect(failed).toContain("  1. Run `test -f tests.pass`. Fix the work, or the check if the check is wrong, until it passes.");
  expect(repo.status("feat", "build")).toBe("IN_PROGRESS");
  expect(repo.state("feat").steps.build.history.at(-1)).toContain("continue refused: script `test -f tests.pass` failed (exit 1)");

  repo.write("tests.pass");
  const passed = repo.ok("continue", "feat");
  expect(passed).toStartWith("build: COMPLETED\n\nSTEP release (3 of 3)");
  expect(repo.state("feat").steps.build.verification).toEqual(["script `test -f tests.pass`: passed"]);
});

test("a script runs from the repository root, knows its step, and shows the end of its output", () => {
  const repo2 = new Repo();
  try {
    repo2.start(
      "env",
      `version: 1
name: env
steps:
  - id: probe
    instruction: x
    gates:
      - script: test "$FUSE_FLOW_SLUG/$FUSE_FLOW_STEP" = env/probe && test -f workflow-source.yml && seq 1 100 && exit 7
`,
    );
    const out = repo2.refused("continue", "env");
    expect(out).toContain("failed (exit 7)");
    expect(out).toContain("\n81\n");
    expect(out).toContain("\n100\n");
    expect(out).not.toContain("\n80\n");
  } finally {
    repo2.cleanup();
  }
});

const CHECKED = `version: 1
name: checked
steps:
  - id: build
    instruction: Build it.
    gates:
      - check: default
      - check: lint
`;

test("a check gate runs the command the policy binds, and says where the binding is", () => {
  const r = new Repo();
  try {
    const unbound = r.start("feat", CHECKED);
    expect(unbound).toContain("  1. This project has no command for the default check yet. Find it in the project");
    expect(unbound).toContain("If the project has no check command for agents, suggest that the owner add one");
    expect(r.refused("continue", "feat")).toStartWith("REFUSED: This project has no command for the default check yet.");

    r.write(".konductor/policy-overrides.yml", 'checks:\n  default: test -f built\n  lint: "none"\n');
    const bound = r.ok("start", "feat");
    expect(bound).toContain(
      "  1. Run `test -f built`, the project's default check (bound in .konductor/policy-overrides.yml). Fix the work",
    );
    expect(bound).toContain("  2. The lint check is not configured in this project (bound to none in .konductor/policy-overrides.yml); there is nothing to run.");
    expect(r.refused("continue", "feat")).toContain("REFUSED: check default (`test -f built`) failed (exit 1)");
    expect(r.state("feat").steps.build.verification).toEqual(["check default (`test -f built`): failed (exit 1)", "check lint: not run"]);
    expect(r.ok("continue", "feat", "--blocked", "x")).toContain("VERIFICATION: check default (`test -f built`): failed (exit 1); check lint: not run");
    r.ok("continue", "feat", "--owner-approved");
    r.cleanupPath(".konductor/workstreams");
    r.start("feat", CHECKED);

    r.write("built");
    expect(r.ok("continue", "feat")).toContain("STATUS: workflow complete");
    expect(r.state("feat").steps.build.verification).toEqual([
      "check default (`test -f built`): passed",
      "check lint: not configured in this project",
    ]);
  } finally {
    r.cleanup();
  }
});

test("the policy files override each other from the general to the specific (decisions 37 and 44)", () => {
  const r = new Repo();
  try {
    r.write("home/.konductor/policy-overrides.yml", "checks:\n  default: echo user\n  lint: echo user-lint\n");
    r.write(".konductor/policy-overrides.yml", "checks:\n  default: echo team\n");
    const team = r.start("feat", CHECKED);
    expect(team).toContain("Run `echo team`, the project's default check (bound in .konductor/policy-overrides.yml)");
    expect(team).toContain(`Run \`echo user-lint\`, the project's lint check (bound in home/.konductor/policy-overrides.yml)`);

    r.write(".konductor/policy-overrides.local.yml", "checks:\n  default: echo mine\n");
    expect(r.ok("start", "feat")).toContain("Run `echo mine`, the project's default check (bound in .konductor/policy-overrides.local.yml)");

    r.write(".konductor/policy-overrides.yml", "checks:\n  default: [not, a, command]\n");
    expect(r.refused("start", "feat")).toContain(".konductor/policy-overrides.yml is not a valid policy file");
  } finally {
    r.cleanup();
  }
});

test("a check names a kind; a command written as a check is refused with the script form (decision 41)", () => {
  const out = repo.refused("validate", repo.write("bad.yml", CHECKED.replace("check: lint", "check: npm test")));
  expect(out).toContain("check names a kind of check, a single lower-case word such as default; for a command use `script: npm test`");
  for (const legacy of ["owner", "none"]) {
    const bad = repo.refused("validate", repo.write(`${legacy}.yml`, CHECKED.replace("- check: lint", `- ${legacy}`)));
    expect(bad).toContain(`the legacy gate \`${legacy}\` is no longer accepted`);
  }
});

test("failed checks never block a step; the agent reports it blocked, and the owner can accept it as it is", () => {
  approveDesign();
  for (let i = 0; i < 4; i++) repo.refused("continue", "feat");
  expect(repo.status("feat", "build")).toBe("IN_PROGRESS");

  const blocked = repo.ok("continue", "feat", "--blocked", "the test needs a database this host does not have");
  expect(blocked).toStartWith("build: BLOCKED: the test needs a database this host does not have\n\nOWNER'S TURN:");
  // The last refused attempt's results stay visible to the owner (decision 22).
  expect(blocked).toContain("VERIFICATION: script `test -f tests.pass`: failed (exit 1)\n");
  expect(blocked).toContain("STATUS: blocked. blocked by the agent: the test needs a database this host does not have\n");
  expect(repo.status("feat", "build")).toBe("BLOCKED");

  // Once blocked, only the owner moves it on, even if the check would pass now.
  repo.write("tests.pass");
  expect(repo.refused("continue", "feat")).toContain('step "build" is BLOCKED; only the owner can move it on');
  expect(repo.refused("continue", "feat", "--blocked", "again")).toContain('step "build" is BLOCKED; only the owner can move it on');

  const resumed = repo.ok("start", "feat");
  expect(resumed).toContain('  - The owner accepts the step as it is: run `fuse-flow continue feat --owner-approved --note "<the owner\'s decision>"`.');
  expect(resumed).toContain("  - The owner sends the work back: run `fuse-flow continue feat --back-to <step>");
  expect(resumed).toContain("name the step that produces it: design (design.md), build.");
  // build has no agent gate, so there are no review rounds to grant, and no gate suggests a step.
  expect(resumed).not.toContain("--more-rounds");
  expect(resumed).not.toContain("the step's gates suggest");
  expect(repo.refused("continue", "feat", "--more-rounds", "1")).toContain('step "build" has no agent gate');

  const accepted = repo.ok("continue", "feat", "--owner-approved", "--note", "accepted without the database test");
  expect(repo.status("feat", "build")).toBe("COMPLETED");
  expect(accepted).toContain("STEP release (3 of 3)");
});

test("an agent gate prints its review and its round cap: 2, the workflow's max_rounds, or the policy's", () => {
  const other = new Repo();
  try {
    const wf = `version: 1
name: w
steps:
  - id: review
    instruction: Review the change.
    updates:
      - artifact: patch
        path: src/
    gates:
      - agent: review the diff against the spec
        max_rounds: 3
      - agent("check the docs")
`;
    const out = other.start("feat", wf);
    expect(out).toContain(
      "  1. Have an independent agent review the diff against the spec. It reviews src/. Classify each finding as fix " +
        "required or false positive, with the reason; a finding the owner already accepted or deferred is not a " +
        "required fix. Fix what is required and review again, until a round ends with no required fix. Every round " +
        "that ends with a required fix counts, whatever the cause. After 3 such rounds, do not start another; run " +
        '`fuse-flow continue feat --blocked "<what is still open, and why the review does not converge>"`.',
    );
    expect(out).toContain("  2. Have an independent agent check the docs. It reviews src/.");
    expect(out).toContain("After 2 such rounds, do not start another");

    // The user's policy fills in only what the workflow leaves open; the team's wins over the workflow.
    other.write("home/.konductor/policy-overrides.yml", "review:\n  max_rounds: 5\n  reviewer: a different model\n");
    const user = other.ok("start", "feat");
    expect(user).toContain("After 3 such rounds");
    expect(user).toContain("After 5 such rounds");
    expect(user).toContain("The reviewer: a different model.");
    other.write(".konductor/policy-overrides.yml", "review:\n  max_rounds: 1\n");
    expect(other.ok("start", "feat").match(/After 1 such rounds/g)).toHaveLength(2);
  } finally {
    other.cleanup();
  }
});

test("a review guide comes from the winning library entry only; a replaced library is not looked at", () => {
  const r = new Repo();
  try {
    r.start(
      "feat",
      `version: 1
name: w
steps:
  - id: write
    instruction: Write it.
    produces:
      - artifact: essay
        path: essay.md
    gates:
      - agent: review the essay
`,
    );
    // The user's library has a review guide for essay, filed twice.
    r.write("home/.konductor/library/artifacts/essay/review.md", "# user rules\n");
    r.write("home/.konductor/library/artifacts/writing/essay/review.md", "# user rules\n");
    // The project's entry, with a guide and no review guide, replaces both.
    r.write(".konductor/library/artifacts/essay/guide.md", "# guide\n");
    expect(r.ok("start", "feat")).toContain(
      "It reviews essay.md, with its guide .konductor/library/artifacts/essay/guide.md as the definition of a good artifact.",
    );
  } finally {
    r.cleanup();
  }
});

test("a review guide decides the pass rule; a project's own replaces the workflow's gate guide (decision 17)", () => {
  const r = new Repo();
  try {
    r.write("flows/review-rules.md", "# rules\n");
    r.write(
      "flows/wf.yml",
      `version: 1
name: w
steps:
  - id: write
    instruction: Write it.
    produces:
      - artifact: essay
        path: essay.md
    gates:
      - agent: review the essay
        guide: review-rules.md
`,
    );
    const out = r.ok("start", "feat", "--workflow", `${r.root}/flows/wf.yml`);
    expect(out).toContain("It reviews essay.md against flows/review-rules.md. Classify each finding as fix required or false positive");
    expect(out).toContain("no required fix. The review guide decides what counts as a required fix and when a round passes.");

    r.write(".konductor/library/artifacts/essay/review.md", "# house rules\n");
    expect(r.ok("start", "feat")).toContain("It reviews essay.md against .konductor/library/artifacts/essay/review.md.");
    // An entry in a folder below artifacts/ is found the same way.
    r.cleanupPath(".konductor/library/artifacts/essay");
    r.write(".konductor/library/artifacts/prose/essay/review.md", "# house rules\n");
    expect(r.ok("start", "feat")).toContain("It reviews essay.md against .konductor/library/artifacts/prose/essay/review.md.");
    r.write(".konductor/review.md", "# policy guide\n");
    r.write(".konductor/policy-overrides.yml", "review:\n  guide: review.md\n");
    expect(r.ok("start", "feat")).toContain("It reviews essay.md against .konductor/review.md.");
  } finally {
    r.cleanup();
  }
});

const REVIEWED = `version: 1
name: reviewed
steps:
  - id: spec
    instruction: Write the spec.
    produces:
      - artifact: paper
        path: spec.md
  - id: implement
    instruction: Implement the spec.
    gates:
      - agent: review the diff against the spec
        route_back_to: [spec, implement]
  - id: release
    instruction: Release it.
`;

test("the owner can grant more review rounds, on a blocked step or ahead of time (decision 45)", () => {
  const other = new Repo();
  try {
    other.start("feat", REVIEWED);
    other.write("spec.md");
    expect(other.ok("continue", "feat")).toContain("After 2 such rounds, do not start another");

    // Ahead of time, on a step in progress.
    const early = other.ok("continue", "feat", "--more-rounds", "1", "--note", "this one is hard");
    expect(early).toStartWith("implement: owner granted 1 more review round; the step is IN_PROGRESS\n\nSTEP implement");
    expect(early).toContain("After 3 (2 plus 1 granted by the owner) such rounds");

    const blocked = other.ok("continue", "feat", "--blocked", "the reviewer wants an API the spec rules out");
    expect(blocked).toContain('  - The owner grants more review rounds: run `fuse-flow continue feat --more-rounds <n> --note "<the owner\'s decision>"`.');
    expect(blocked).toContain("; the step's gates suggest spec or implement.");
    expect(blocked).toContain("VERIFICATION: review (review the diff against the spec): <rounds used> of 3 (2 plus 1 granted by the owner) rounds");
    expect(other.refused("continue", "feat")).toContain('step "implement" is BLOCKED');

    const granted = other.ok("continue", "feat", "--more-rounds", "2");
    expect(granted).toContain("After 5 (2 plus 3 granted by the owner) such rounds");
    expect(other.status("feat", "implement")).toBe("IN_PROGRESS");
    expect(other.ok("continue", "feat")).toContain("STEP release (3 of 3)");
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
    other.ok("continue", "feat", "--blocked", "the spec itself is wrong about the API");

    expect(other.refused("continue", "feat", "--back-to", "release")).toContain('step "release" comes after "implement"');
    expect(other.refused("continue", "feat", "--back-to", "nowhere")).toContain('no step "nowhere" in workflow reviewed');

    const back = other.ok("continue", "feat", "--back-to", "spec", "--note", "fix the API section first");
    expect(back).toStartWith(
      "implement: owner sent the work back to spec\nIf any of spec.md keeps a status of its own, as its guide says, set it back to draft.\n\nSTEP spec (1 of 3)",
    );
    // The file this workstream wrote is rework, not a file someone else left there.
    expect(back).not.toContain("already existed");
    const spec = other.state("feat").steps.spec;
    expect(spec.status).toBe("IN_PROGRESS");
    expect(spec.artifacts).toEqual([{ artifact: "paper", path: "spec.md", status: "draft" }]);
    expect(spec.history.at(-2)).toContain("owner sent the work back from implement to spec: fix the API section first");
    expect(other.state("feat").steps.implement.status).toBe("PENDING");
    // spec.md is still on disk, so the agent can amend it and continue.
    expect(other.ok("continue", "feat")).toContain("STEP implement (2 of 3)");
  } finally {
    other.cleanup();
  }
});

test("--back-to answers a step that awaits the owner or is blocked", () => {
  expect(repo.refused("continue", "feat", "--back-to", "design")).toContain(
    'step "design" is IN_PROGRESS; --back-to answers a step that awaits the owner or is blocked',
  );
  repo.write("design.md");
  repo.ok("continue", "feat");
  expect(repo.refused("continue", "feat", "--more-rounds", "1")).toContain('step "design" has no agent gate');
  expect(repo.ok("continue", "feat", "--back-to", "design")).toContain("STEP design (1 of 3)");
});

test("a produces path that existed before the step, unrecorded, is reported when the step is handed out", () => {
  const r = new Repo();
  try {
    r.write("design.md", "someone else's\n");
    const out = r.start("feat", GATED);
    expect(out).toContain("design.md already existed when the step was handed out, and this workstream did not write it.");
    expect(r.state("feat").steps.design.existed).toEqual(["design.md"]);
    expect(r.ok("continue", "feat")).toContain("PRODUCED: design.md (updated)");
  } finally {
    r.cleanup();
  }
});

test("--more-rounds takes a whole number, and each owner decision goes alone", () => {
  expect(repo.usage("continue", "feat", "--more-rounds", "0")).toContain("--more-rounds takes a whole number of rounds, 1 or more");
  expect(repo.usage("continue", "feat", "--more-rounds", "two")).toContain("--more-rounds takes a whole number");
  expect(repo.usage("continue", "feat", "--more-rounds", "1", "--owner-approved")).toContain("--owner-approved and --more-rounds are different decisions");
  expect(repo.usage("continue", "feat", "--back-to", "design", "--updated", "a")).toContain("--updated reports the agent's work; it does not go with --back-to");
});

test("--blocked needs a reason and goes with no other option", () => {
  expect(repo.usage("continue", "feat", "--blocked")).toContain("--blocked");
  expect(repo.usage("continue", "feat", "--blocked=")).toContain("--blocked needs a value");
  expect(repo.usage("continue", "feat", "--blocked", "x", "--owner-approved")).toContain("are different decisions");
  expect(repo.usage("continue", "feat", "--blocked", "x", "--updated", "a")).toContain("--updated reports the agent's work; it does not go with --blocked");
  expect(repo.status("feat", "design")).toBe("IN_PROGRESS");
});

test("continue still succeeds and prints the next step when its check changes the workflow file", () => {
  const other = new Repo();
  try {
    other.start("feat", "version: 1\nname: w\nsteps:\n  - id: a\n    instruction: a\n    gates: \"script: rm workflow-source.yml\"\n  - id: b\n    instruction: b\n");
    expect(other.ok("continue", "feat")).toContain("STEP b (2 of 2)");
    expect(other.status("feat", "a")).toBe("COMPLETED");
  } finally {
    other.cleanup();
  }
});

test("two continue commands at once record the step once", async () => {
  const same = new Repo();
  try {
    same.start("feat", "version: 1\nname: same\nsteps:\n  - id: build\n    instruction: x\n    gates:\n      - script: sleep 1\n");
    const results = await Promise.all([same.runInBackground(["continue", "feat"]), same.runInBackground(["continue", "feat"])]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.code === 1)?.out).toContain('step "build" is COMPLETED now; run the command again');
    expect(same.state("feat").steps.build).toMatchObject({ status: "COMPLETED" });
  } finally {
    same.cleanup();
  }
});
