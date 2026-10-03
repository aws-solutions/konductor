// SPDX-License-Identifier: Apache-2.0
// Optional steps and jumps: a condition says when a step runs (decision 32),
// --skip skips a step, and the owner can start at a later step or jump
// forward (decision 33).

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const flow = (condition: string) => `version: 1
name: optional
steps:
  - id: research
    instruction: Map the area.
${condition}
  - id: build
    instruction: Build it.
  - id: release
    instruction: Release it.
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("a script condition that exits 0 runs the step; any other exit skips it with the reason", () => {
  repo.write("flag");
  const runs = repo.start("feat", flow("    condition:\n      script: test -f flag"));
  expect(runs).toContain("STEP research (1 of 3): Map the area.\nCONDITION: condition `test -f flag` exited 0, so the step runs.\n");

  const skips = repo.start("other", flow("    condition:\n      script: test -f nothing-here"));
  expect(skips).toContain("STEP build (2 of 3): Build it.");
  const state = repo.state("other").steps.research;
  expect(state.status).toBe("SKIPPED");
  expect(state.skip_reason).toBe("condition `test -f nothing-here` exited 1");
});

test("a check condition runs the command the policy binds; an unbound kind holds the step until it is bound", () => {
  const out = repo.start("feat", flow("    condition: \"check: unfamiliar\""));
  expect(out).toContain("STEP research (1 of 3) cannot be handed out yet: its condition names the unfamiliar check.");
  expect(out).toContain("record it in .konductor/policy-overrides.yml as `checks: { unfamiliar: <command> }`");
  expect(repo.status("feat", "research")).toBe("PENDING");
  expect(repo.refused("continue", "feat")).toContain("cannot be handed out yet");

  repo.write(".konductor/policy-overrides.yml", "checks:\n  unfamiliar: \"false\"\n");
  expect(repo.ok("start", "feat")).toContain("STEP build (2 of 3)");
  expect(repo.state("feat").steps.research.skip_reason).toBe("condition `false` exited 1");
});

test("an agent condition asks the agent to judge, and --skip records its reason", () => {
  const out = repo.start("feat", flow("    condition:\n      agent: the work touches an unfamiliar area"));
  expect(out).toContain(
    'CONDITION: Do this step only if the work touches an unfamiliar area. Otherwise run `fuse-flow continue feat --skip "<why it does not apply>"`.',
  );
  const skipped = repo.ok("continue", "feat", "--skip", "the area is well known");
  expect(skipped).toStartWith("research: SKIPPED: the area is well known\n\nSTEP build");
  expect(repo.state("feat").steps.research.history.at(-1)).toContain("skipped: the area is well known");
});

test("an owner-action condition tells the agent to ask the owner first", () => {
  const out = repo.start("feat", flow("    condition:\n      owner-action: decide whether this change needs research"));
  expect(out).toContain("CONDITION: Before you start, ask the owner to decide whether this change needs research");
  expect(out).toContain("STATUS needs input");
});

test("a condition has no gate-only fields, and a step has one condition", () => {
  const out = repo.refused("validate", repo.write("bad.yml", flow("    condition:\n      agent: x\n      max_rounds: 2")));
  expect(out).toContain("a condition has no max_rounds");
  const list = repo.refused("validate", repo.write("list.yml", flow("    condition:\n      - agent: x")));
  expect(list).toContain("steps.0.condition");
});

test("a mandatory step is skipped only on the owner's request, and the history says so", () => {
  repo.start("feat", flow(""));
  repo.ok("continue", "feat"); // research
  repo.ok("continue", "feat"); // build
  // The last step, which --forward-to cannot reach past (decision 45).
  const out = repo.ok("continue", "feat", "--skip", "the owner releases it by hand");
  expect(out).toContain("STATUS: workflow complete");
  expect(out).toContain("Skipped steps: release (the owner releases it by hand).");
  expect(repo.state("feat").steps.release.history.at(-1)).toContain("skipped on the owner's request: the owner releases it by hand");
});

test("start --from begins a new workstream at a later step; the steps before it are SKIPPED", () => {
  const wf = repo.write("wf.yml", flow(""));
  const out = repo.ok("start", "feat", "--workflow", wf, "--from", "build");
  expect(out).toContain("STEP build (2 of 3)");
  expect(repo.state("feat").steps.research).toMatchObject({ status: "SKIPPED", skip_reason: "started at build" });
  expect(repo.refused("start", "feat", "--from", "release")).toContain("workstream feat exists; --from starts a new one");
  expect(repo.refused("start", "other", "--workflow", wf, "--from", "nope")).toContain('no step "nope" in workflow optional');
});

test("--forward-to jumps forward; the current step and those before the target are SKIPPED with the owner's note", () => {
  repo.start("feat", flow(""));
  expect(repo.refused("continue", "feat", "--forward-to", "research")).toContain('step "research" is not after "research"');
  const out = repo.ok("continue", "feat", "--forward-to", "release", "--note", "split off the build");
  expect(out).toStartWith("jumped forward from research to release\n\nSTEP release (3 of 3)");
  for (const id of ["research", "build"]) {
    expect(repo.state("feat").steps[id]).toMatchObject({ status: "SKIPPED", skip_reason: "owner jumped forward to release: split off the build" });
  }
  expect(repo.usage("continue", "feat", "--forward-to", "release", "--skip", "x")).toContain("are different decisions; give one");
});
