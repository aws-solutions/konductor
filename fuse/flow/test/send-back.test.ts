// SPDX-License-Identifier: Apache-2.0
// Sending work back to an earlier step, end to end. Each test reproduces a
// surprise from a real workstream that was sent back from its prototype step
// to its requirements step (docs/specs/2026-10-07-fuse-flow-send-back-rules.md).

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers.ts";

const SYSTEM = `version: 1
name: system
steps:
  - id: intake
    instruction: Write down what the owner wants.
    produces:
      - artifact: requirements
        path: requirements.md
  - id: requirements
    instruction: Turn the draft into requirements.
    updates:
      - artifact: requirements
        path: requirements.md
    gates:
      - agent: review the requirements
        max_rounds: 2
      - owner-action: approve the requirements
  - id: prototype
    condition:
      agent: an assumption needs an experiment
    instruction: Run the experiments the owner agrees to, one research note each.
    consumes: [requirements]
    produces:
      - artifact: notes
        path: research/
  - id: design
    instruction: Design it, citing the research notes.
    consumes: [requirements, notes]
    produces:
      - artifact: design
        path: design.md
`;

let r: Repo;

beforeEach(() => {
  r = new Repo();
  // The research folder is shared with other work, so it exists before the workstream.
  r.write("research/someone-elses.md");
  r.start("ds", SYSTEM);
  r.write("requirements.md", "Status: draft\n");
  r.ok("continue", "ds"); // intake
  r.ok("continue", "ds", "--updated", "requirements.md"); // requirements, awaits the owner
  r.ok("continue", "ds", "--owner-approved");
  expect(r.status("ds", "prototype")).toBe("IN_PROGRESS");
});

afterEach(() => r.cleanup());

const history = (step: string): string[] => r.state("ds").steps[step].history;

test("the owner sends work back from a step in progress, with no false block", () => {
  r.write("research/harness.md");
  const out = r.ok("continue", "ds", "--back-to", "requirements", "--updated", "research/harness.md", "--note", "the experiments changed the requirements");
  expect(out).toStartWith("prototype: owner sent the work back to requirements");
  expect(history("prototype").some((h) => h.includes("blocked"))).toBe(false);
  expect(r.status("ds", "requirements")).toBe("IN_PROGRESS");
  expect(r.status("ds", "prototype")).toBe("PENDING");
});

test("work a step had written is kept through a send-back and offered to its next pass", () => {
  r.write("research/harness.md");
  r.write("research/chat.md");
  r.ok("continue", "ds", "--back-to", "requirements", "--updated", "research/harness.md", "--updated", "research/chat.md");
  expect(r.state("ds").steps.prototype.artifacts).toEqual([
    { artifact: "notes", path: "research/harness.md", status: "draft" },
    { artifact: "notes", path: "research/chat.md", status: "draft" },
  ]);

  r.ok("continue", "ds", "--updated", "requirements.md");
  const again = r.ok("continue", "ds", "--owner-approved");
  expect(again).toContain(
    "EARLIER PASS: this step ran before the owner sent the work back, and wrote research/harness.md, research/chat.md. " +
      "Check each against what changed since: keep it, update it, or redo it, and propose to the owner which.",
  );
  // The folder existed before the workstream, but the workstream did write in it.
  expect(again).not.toContain("this workstream did not write it");
  expect(again).toContain("research/ existed before this workstream; the files this workstream wrote in it are listed under EARLIER PASS.");

  // Finishing again keeps the earlier notes that are still on disk, beside the new one.
  r.write("research/independent-check.md");
  const design = r.ok("continue", "ds", "--updated", "research/independent-check.md");
  expect(r.state("ds").steps.prototype.artifacts.map((a: { path: string }) => a.path)).toEqual([
    "research/independent-check.md",
    "research/harness.md",
    "research/chat.md",
  ]);
  // The next step reads the notes themselves, not the shared folder.
  expect(design).toContain("READ research/independent-check.md, research/harness.md, research/chat.md (from step prototype).");
  expect(design).not.toContain("READ research/ ");
});

test("earlier-pass files count only while they exist, and never override --not-produced", () => {
  r.write("research/harness.md");
  r.ok("continue", "ds", "--back-to", "requirements", "--updated", "research/harness.md");
  r.ok("continue", "ds", "--updated", "requirements.md");
  r.ok("continue", "ds", "--owner-approved");

  // The earlier note is gone, so the shared folder alone does not finish the step.
  r.cleanupPath("research/harness.md");
  expect(r.refused("continue", "ds")).toContain("research/ (notes) existed before the step");

  // Notes that no longer apply are not recorded once the agent reports the artifact not produced.
  r.write("research/harness.md");
  const design = r.ok("continue", "ds", "--not-produced", "notes", "the new requirements leave nothing to test");
  expect(r.state("ds").steps.prototype.artifacts).toEqual([]);
  expect(design).not.toContain("READ research/");
  expect(design).toContain("READ notes: step prototype did not produce it (the new requirements leave nothing to test)");
});

test("a step that ran and was then skipped starts a new pass when the work is sent back to it", () => {
  r.ok("continue", "ds", "--skip", "no experiment needed after all");
  r.ok("continue", "ds", "--back-to", "prototype");
  expect(r.state("ds").steps.prototype.pass).toBe(2);
});

test("an optional folder that existed before the step is recorded only by the files the step wrote in it", () => {
  const o = new Repo();
  try {
    o.write("notes/old.md");
    const out = o.start(
      "opt",
      `version: 1
name: opt
steps:
  - id: explore
    instruction: Explore.
    optional_produces:
      - artifact: notes
        path: notes/
  - id: use
    instruction: Use the notes.
    consumes: [notes]
`,
    );
    expect(out).toContain("notes/ existed before the step; name each file you write in it with --updated <file>.");
    const next = o.ok("continue", "opt");
    expect(o.state("opt").steps.explore.artifacts).toEqual([]);
    expect(next).toContain("READ notes: step explore wrote nothing in notes/, so there is nothing from it to read.");
    expect(next).not.toContain("READ notes/");
  } finally {
    o.cleanup();
  }
});

test("a produced folder that existed before the step needs the files the step wrote in it", () => {
  const out = r.refused("continue", "ds");
  expect(out).toContain(
    "research/ (notes) existed before the step: name each file the step wrote in it with --updated <file>, or report " +
      'it with --not-produced notes "<reason>".',
  );
  expect(r.ok("continue", "ds", "--not-produced", "notes", "no experiment was needed")).toContain("STEP design");
});

test("the status view lists each file once, under the latest step that records it", () => {
  r.write("research/harness.md");
  r.ok("continue", "ds", "--back-to", "requirements", "--updated", "research/harness.md");
  const rows = r.ok("status", "ds").split("\n");
  expect(rows.find((l) => l.includes(" intake "))).not.toContain("requirements.md");
  expect(rows.find((l) => l.includes(" requirements "))).toContain("requirements.md (draft; also recorded by intake)");
  expect(rows.find((l) => l.includes(" prototype "))).toContain("research/harness.md (draft)");
});

test("a review after a send-back is a new pass with its own findings files and cap", () => {
  const out = r.ok("continue", "ds", "--back-to", "requirements");
  expect(out).toContain(
    "This is pass 2 of this step, because the owner sent the work back: count only this pass's rounds against the cap.",
  );
  expect(out).toContain(".konductor/reviews/ds/requirements-pass-2-round-<n>.json");
  expect(out).toContain(
    "The review covers the whole artifact. Give the reviewer the findings files of the earlier passes of this step, " +
      "in .konductor/reviews/ds/, with how each finding was handled.",
  );
  expect(out).toContain("After 2 such rounds");
});

test("a status message mentions an artifact's guide only when it has one", () => {
  const back = r.ok("continue", "ds", "--back-to", "requirements");
  expect(back).toContain(
    "If any of requirements.md records a status of its own, such as a 'Status: approved' line, set it back to draft.",
  );
  expect(back).not.toContain("as its guide says");

  r.write(".konductor/library/artifacts/requirements/guide.md", "# guide\n");
  r.ok("continue", "ds", "--updated", "requirements.md");
  const approved = r.ok("continue", "ds", "--owner-approved");
  expect(approved).toContain("If any of requirements.md keeps a status of its own, as its guide says, set it to approved.");
});

test("an input from a step whose condition did not hold is reported as nothing to read", () => {
  const out = r.ok("continue", "ds", "--skip", "the requirements leave no assumption open");
  expect(out).toContain(
    "READ notes: step prototype was skipped (the requirements leave no assumption open), so there is nothing from it to read.",
  );
  expect(out).not.toContain("Restore what this step needs");
});

test("the help says what approved means", () => {
  expect(r.ok("help")).toContain("approved means the step's gates passed, whoever ran them");
});
