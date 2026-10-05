// SPDX-License-Identifier: Apache-2.0
// End-to-end tests of applyEdit: real workflow files on disk, real edits, the
// real engine parser. No mocks of our own code.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseWorkflowText } from "../../flow/src/parse.ts";
import YAML from "yaml";
import { applyEdit, type Edit } from "../src/model/yamlEdit.ts";

const WORKFLOWS_DIR = resolve(import.meta.dir, "..", "..", "flow", "workflows");

// Every *.yml under the workflows directory, at any depth, following
// symlinks (personal/ and team/ are symlinks to the real files).
function listWorkflowFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "schemas") continue;
    const full = join(dir, name);
    const real = realpathSync(full);
    const st = statSync(real);
    if (st.isDirectory()) out.push(...listWorkflowFiles(real));
    else if (name.endsWith(".yml")) out.push(full);
  }
  return out;
}

const WORKFLOW_FILES = listWorkflowFiles(WORKFLOWS_DIR);

// A line-level diff: which 0-based line indices differ between two texts.
// Lines are compared by exact content; this is good enough to assert that a
// change stayed confined to the lines it should have touched.
function changedLines(a: string, b: string): Set<number> {
  const la = a.split("\n");
  const lb = b.split("\n");
  const max = Math.max(la.length, lb.length);
  const changed = new Set<number>();
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) changed.add(i);
  }
  return changed;
}

function commentLines(text: string): Map<number, string> {
  const out = new Map<number, string>();
  text.split("\n").forEach((line, i) => {
    if (line.trim().startsWith("#")) out.set(i, line);
  });
  return out;
}

describe("applyEdit on every real workflow file", () => {
  test(`found all ${WORKFLOW_FILES.length} workflow files`, () => {
    expect(WORKFLOW_FILES.length).toBe(12);
  });

  for (const file of WORKFLOW_FILES) {
    const rel = file.slice(WORKFLOWS_DIR.length + 1);

    test(`${rel}: a representative edit stays confined and keeps comments`, () => {
      const original = readFileSync(file, "utf8");
      const before = parseWorkflowText(original);
      expect(before.ok).toBe(true);
      if (!before.ok) return;
      const stepId = before.workflow.steps[0].id;
      const originalTitle = before.workflow.steps[0].title;
      expect(originalTitle).toBeDefined();
      if (originalTitle === undefined) return;
      const newTitle = `${originalTitle} (edited)`;

      const edited = applyEdit(original, { op: "setStepField", step: 0, key: "title", value: newTitle });

      // (a) parses OK
      const after = parseWorkflowText(edited);
      expect(after.ok).toBe(true);
      if (!after.ok) return;

      // (b) reflects the edit
      expect(after.workflow.steps[0].title).toBe(newTitle);
      expect(after.workflow.steps[0].id).toBe(stepId);

      // (c) only the existing title line differs. Using an existing field is
      // deliberate: an insertion shifts later line indices, so a same-index
      // comparison would falsely report every later line as changed.
      const changed = changedLines(original, edited);
      expect(changed.size).toBe(1);
      for (const line of changed) {
        expect(original.split("\n")[line]).toContain("title:");
        expect(edited.split("\n")[line]).toContain(`title: ${newTitle}`);
      }

      // (d) every original comment line outside the edited node survives
      const origComments = commentLines(original);
      const newComments = commentLines(edited);
      for (const [line, text] of origComments) {
        if (changed.has(line)) continue;
        expect(newComments.get(line)).toBe(text);
      }
    });

    test(`${rel}: no-op edit returns an identical string`, () => {
      const original = readFileSync(file, "utf8");
      const parsed = parseWorkflowText(original);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const step = parsed.workflow.steps[0];

      const edited = applyEdit(original, { op: "setStepField", step: 0, key: "title", value: step.title ?? null });
      expect(edited).toBe(original);
    });
  }
});

// The lines that differ between two texts, as one region: everything before
// `start` and from `endA` (in a) / `endB` (in b) onward is identical. Unlike a
// same-index comparison, an insertion does not mark the lines after it.
function changedRegion(a: string, b: string): { start: number; endA: number; endB: number } {
  const la = a.split("\n");
  const lb = b.split("\n");
  let start = 0;
  while (start < la.length && start < lb.length && la[start] === lb[start]) start++;
  let endA = la.length;
  let endB = lb.length;
  while (endA > start && endB > start && la[endA - 1] === lb[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, endA, endB };
}

// The 0-based line span [first, last] of step i in the file's text, widened
// over the comment and blank lines directly above it and the blank lines
// directly below it, which travel with the step when it moves.
function stepLines(text: string, i: number): [number, number] {
  const steps = YAML.parseDocument(text).get("steps") as YAML.YAMLSeq;
  const node = steps.items[i] as YAML.YAMLMap;
  const [start, , end] = node.range!;
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length - 1;
  const lines = text.split("\n");
  // The node's end offset points just past its last character.
  let first = lineOf(start);
  let last = lineOf(Math.max(start, end - 1));
  while (first > 0 && /^\s*(#.*)?$/.test(lines[first - 1])) first--;
  while (last + 1 < lines.length && lines[last + 1].trim() === "") last++;
  return [first, last];
}

// Acceptance (spec): on every real workflow, each kind of edit changes only
// lines inside the step it edits (or, for a move, the two steps it swaps), the
// result is a valid workflow that says what the edit said, and every comment
// outside those lines survives.
describe("acceptance: edits on every real workflow stay inside the step they edit", () => {
  for (const file of WORKFLOW_FILES) {
    const rel = file.slice(WORKFLOWS_DIR.length + 1);
    const original = readFileSync(file, "utf8");
    const parsed = parseWorkflowText(original);
    if (!parsed.ok) throw new Error(`${rel} does not parse`);
    const steps = parsed.workflow.steps;
    const last = steps.length - 1;
    const agentAt = steps.findIndex((s) => s.gates.some((g) => g.kind === "agent"));

    const cases: {
      name: string;
      edit: Edit;
      span: [number, number];
      raw?: boolean;
      check: (w: (typeof steps)[number][]) => void;
    }[] = [
      {
        name: "title",
        edit: { op: "setStepField", step: last, key: "title", value: "A new title" },
        span: [last, last],
        check: (w) => expect(w[last].title).toBe("A new title"),
      },
      {
        name: "folded instruction",
        edit: { op: "setInstruction", step: 0, text: `${"Do the work carefully. ".repeat(12)}Then stop.`, style: ">" },
        span: [0, 0],
        check: (w) => expect(w[0].instruction).toBe(`${"Do the work carefully. ".repeat(12)}Then stop.`),
      },
      {
        name: "literal instruction",
        edit: { op: "setInstruction", step: 0, text: "Line one.\nLine two.", style: "|" },
        span: [0, 0],
        check: (w) => expect(w[0].instruction).toBe("Line one.\nLine two."),
      },
      {
        name: "add an output",
        edit: { op: "addOutput", step: last, mode: "produces", artifact: "extra-notes", path: "docs/{slug}-notes.md" },
        span: [last, last],
        check: (w) => expect(w[last].produces.map((a) => a.artifact)).toContain("extra-notes"),
      },
      {
        name: "add a gate",
        edit: { op: "addGate", step: last, gate: { kind: "owner-action", text: "approve the extra" } },
        span: [last, last],
        check: (w) => expect(w[last].gates.map((g) => g.text)).toContain("approve the extra"),
      },
    ];
    if (agentAt >= 0) {
      const gateIndex = steps[agentAt].gates.findIndex((g) => g.kind === "agent");
      cases.push({
        name: "max_rounds and route_back_to on an agent gate",
        edit: { op: "setGate", step: agentAt, index: gateIndex, fields: { max_rounds: 4, route_back_to: [steps[0].id] } },
        span: [agentAt, agentAt],
        check: (w) => {
          const g = w[agentAt].gates.find((x) => x.kind === "agent")!;
          expect(g.max_rounds).toBe(4);
          expect(g.route_back_to).toEqual([steps[0].id]);
        },
      });
    }
    if (steps.length >= 3) {
      // A move may break consumes or route_back_to order, so this case checks
      // the raw step order instead of requiring a valid workflow.
      cases.push({
        name: "move a step",
        edit: { op: "moveStep", from: 1, to: 2 },
        span: [1, 2],
        raw: true,
        check: () => {},
      });
    }

    for (const c of cases) {
      test(`${rel}: ${c.name}`, () => {
        const edited = applyEdit(original, c.edit);
        if (c.raw) {
          const ids = (YAML.parse(edited).steps as { id: string }[]).map((x) => x.id);
          expect(ids).toEqual([steps[0].id, steps[2].id, steps[1].id, ...steps.slice(3).map((x) => x.id)]);
        } else {
          const after = parseWorkflowText(edited);
          if (!after.ok) throw new Error(`${rel} ${c.name}: ${JSON.stringify(after.issues)}`);
          c.check(after.workflow.steps);
        }
        const [first] = stepLines(original, c.span[0]);
        const [, lastLine] = stepLines(original, c.span[1]);
        const region = changedRegion(original, edited);
        // Unchanged before the edited step(s) and after them.
        expect(region.start).toBeGreaterThanOrEqual(first);
        expect(region.endA).toBeLessThanOrEqual(lastLine + 1);
        // Every comment outside the edited step(s) survives.
        const lines = original.split("\n");
        const keptBefore = lines.slice(0, first).join("\n");
        const keptAfter = lines.slice(lastLine + 1).join("\n");
        expect(edited.startsWith(keptBefore)).toBe(true);
        expect(edited.endsWith(keptAfter)).toBe(true);
      });
    }
  }
});

describe("setWorkflowField", () => {
  const text = `version: 1
name: demo
description: old description
steps:
  - id: one
    instruction: Do it.
`;

  test("sets name", () => {
    const edited = applyEdit(text, { op: "setWorkflowField", key: "name", value: "renamed" });
    expect(edited).toContain("name: renamed\n");
    expect(parseWorkflowText(edited)).toMatchObject({ ok: true });
    const changed = changedLines(text, edited);
    expect(changed).toEqual(new Set([1]));
  });

  test("sets description when absent", () => {
    const noDesc = `version: 1\nname: demo\nsteps:\n  - id: one\n    instruction: Do it.\n`;
    const edited = applyEdit(noDesc, { op: "setWorkflowField", key: "description", value: "a new one" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.description).toBe("a new one");
  });

  test("clears description (removes the key)", () => {
    const edited = applyEdit(text, { op: "setWorkflowField", key: "description", value: null });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.description).toBeUndefined();
    expect(edited).not.toContain("description:");
  });

  test("no-op returns identical string", () => {
    const edited = applyEdit(text, { op: "setWorkflowField", key: "description", value: "old description" });
    expect(edited).toBe(text);
  });
});

describe("setStepField", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    title: One
    instruction: Do it.
  - id: two
    instruction: Do it too.
    gates:
      - owner-action: approve
        route_back_to: one
`;

  test("sets title", () => {
    const edited = applyEdit(text, { op: "setStepField", step: 0, key: "title", value: "New Title" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].title).toBe("New Title");
  });

  test("clears title", () => {
    const edited = applyEdit(text, { op: "setStepField", step: 0, key: "title", value: null });
    expect(edited).not.toContain("title:");
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].title).toBeUndefined();
  });

  test("sets phase when absent, inserted in key order", () => {
    const edited = applyEdit(text, { op: "setStepField", step: 0, key: "phase", value: "Build" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].phase).toBe("Build");
    // phase must land after title and before instruction
    const lines = edited.split("\n");
    const titleIdx = lines.findIndex((l) => l.includes("title: One"));
    const phaseIdx = lines.findIndex((l) => l.includes("phase: Build"));
    const instrIdx = lines.findIndex((l) => l.includes("instruction: Do it."));
    expect(titleIdx).toBeLessThan(phaseIdx);
    expect(phaseIdx).toBeLessThan(instrIdx);
  });

  test("renaming id rewrites route_back_to elsewhere (scalar form)", () => {
    const edited = applyEdit(text, { op: "setStepField", step: 0, key: "id", value: "first" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workflow.steps[0].id).toBe("first");
    expect(parsed.workflow.steps[1].gates[0].route_back_to).toEqual(["first"]);
  });

  test("renaming id rewrites route_back_to elsewhere (list form)", () => {
    const withList = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
  - id: two
    instruction: Do it too.
  - id: three
    instruction: Review.
    gates:
      - agent: review
        route_back_to: [one, two]
`;
    const edited = applyEdit(withList, { op: "setStepField", step: 0, key: "id", value: "first" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workflow.steps[2].gates[0].route_back_to).toEqual(["first", "two"]);
  });

  test("no-op on id returns identical string", () => {
    const edited = applyEdit(text, { op: "setStepField", step: 0, key: "id", value: "one" });
    expect(edited).toBe(text);
  });
});

describe("setInstruction", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: >
      Old folded text here.
`;

  test("rewrites a folded instruction, wrapped at ~100 columns", () => {
    const long = "word ".repeat(40).trim();
    const edited = applyEdit(text, { op: "setInstruction", step: 0, text: long, style: ">" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].instruction.trim()).toBe(long);
    const lines = edited.split("\n");
    const bodyLines = lines.filter((l) => l.startsWith("      ") && l.trim().length > 0);
    for (const l of bodyLines) expect(l.length).toBeLessThanOrEqual(110);
  });

  test("switches to literal style", () => {
    const edited = applyEdit(text, { op: "setInstruction", step: 0, text: "Line one.\nLine two.", style: "|" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].instruction).toBe("Line one.\nLine two.");
    expect(edited).toContain("instruction: |\n");
  });

  test("honors folded style for a short instruction", () => {
    const edited = applyEdit(text, { op: "setInstruction", step: 0, text: "Do the thing.", style: ">" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].instruction).toBe("Do the thing.");
    expect(edited).toContain("instruction: >\n");
  });
});

describe("setCondition", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: Maybe do it.
  - id: two
    instruction: Do it too.
`;

  test("sets a check condition", () => {
    const edited = applyEdit(text, { op: "setCondition", step: 0, condition: { kind: "check", text: "default" } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].condition).toEqual({ kind: "check", text: "default" });
  });

  test("sets then changes an agent condition with description", () => {
    const withCond = applyEdit(text, {
      op: "setCondition",
      step: 0,
      condition: { kind: "agent", text: "only when risky", description: "judgment call" },
    });
    const parsed1 = parseWorkflowText(withCond);
    expect(parsed1.ok).toBe(true);
    if (parsed1.ok) expect(parsed1.workflow.steps[0].condition).toEqual({ kind: "agent", text: "only when risky", description: "judgment call" });
    expect(withCond).toContain("description: judgment call");

    const changed = applyEdit(withCond, { op: "setCondition", step: 0, condition: { kind: "script", text: "check.sh" } });
    const parsed2 = parseWorkflowText(changed);
    expect(parsed2.ok).toBe(true);
    if (parsed2.ok) expect(parsed2.workflow.steps[0].condition).toEqual({ kind: "script", text: "check.sh" });
  });

  test("clears a condition", () => {
    const withCond = applyEdit(text, { op: "setCondition", step: 0, condition: { kind: "check", text: "default" } });
    const cleared = applyEdit(withCond, { op: "setCondition", step: 0, condition: null });
    const parsed = parseWorkflowText(cleared);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].condition).toBeUndefined();
    expect(cleared).toBe(text);
  });
});

describe("setConsumes", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: Produce.
    produces:
      - artifact: notes
        path: notes.md
  - id: two
    instruction: Consume.
`;

  test("adds a consumes list", () => {
    const edited = applyEdit(text, { op: "setConsumes", step: 1, ids: ["notes"] });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[1].consumes).toEqual(["notes"]);
    expect(edited).toContain("consumes: [notes]");
  });

  test("multiple ids as a flow list", () => {
    const withTwo = `version: 1
name: demo
steps:
  - id: one
    instruction: Produce.
    produces:
      - artifact: notes
        path: notes.md
      - artifact: plan
        path: plan.md
  - id: two
    instruction: Consume.
`;
    const edited = applyEdit(withTwo, { op: "setConsumes", step: 1, ids: ["notes", "plan"] });
    expect(edited).toContain("consumes: [notes, plan]");
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[1].consumes).toEqual(["notes", "plan"]);
  });

  test("empty list removes the key", () => {
    const withConsumes = applyEdit(text, { op: "setConsumes", step: 1, ids: ["notes"] });
    const removed = applyEdit(withConsumes, { op: "setConsumes", step: 1, ids: [] });
    expect(removed).toBe(text);
  });
});

describe("outputs: addOutput, removeOutput, setOutput, changeOutputMode", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
    produces:
      - artifact: notes
        path: notes.md
        description: the notes
`;

  test("addOutput appends a new block-mapping entry", () => {
    const edited = applyEdit(text, { op: "addOutput", step: 0, mode: "produces", artifact: "plan", path: "plan.md" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].produces).toEqual([
      { artifact: "notes", path: "notes.md", description: "the notes" },
      { artifact: "plan", path: "plan.md" },
    ]);
  });

  test("addOutput to a single (non-list) existing artifact converts it to a list", () => {
    const single = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
    produces:
      artifact: notes
      path: notes.md
`;
    const edited = applyEdit(single, { op: "addOutput", step: 0, mode: "produces", artifact: "plan", path: "plan.md" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.workflow.steps[0].produces).toEqual([
        { artifact: "notes", path: "notes.md" },
        { artifact: "plan", path: "plan.md" },
      ]);
  });

  test("addOutput creates the key when the mode is absent", () => {
    const edited = applyEdit(text, { op: "addOutput", step: 0, mode: "optional_produces", artifact: "extra", path: "extra.md" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].optional_produces).toEqual([{ artifact: "extra", path: "extra.md" }]);
  });

  test("removeOutput removes the one entry and the key", () => {
    const edited = applyEdit(text, { op: "removeOutput", step: 0, mode: "produces", index: 0 });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].produces).toEqual([]);
    expect(edited).not.toContain("produces:");
  });

  test("removeOutput removes one of several entries, keeping the key", () => {
    const two = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
    produces:
      - artifact: notes
        path: notes.md
      - artifact: plan
        path: plan.md
`;
    const edited = applyEdit(two, { op: "removeOutput", step: 0, mode: "produces", index: 0 });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].produces).toEqual([{ artifact: "plan", path: "plan.md" }]);
  });

  test("setOutput changes fields in place", () => {
    const edited = applyEdit(text, { op: "setOutput", step: 0, mode: "produces", index: 0, fields: { path: "new-notes.md", description: null } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].produces).toEqual([{ artifact: "notes", path: "new-notes.md" }]);
  });

  test("changeOutputMode moves an entry from one mode list to another", () => {
    const edited = applyEdit(text, { op: "changeOutputMode", step: 0, mode: "produces", index: 0, to: "updates" });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workflow.steps[0].produces).toEqual([]);
    expect(parsed.workflow.steps[0].updates).toEqual([{ artifact: "notes", path: "notes.md", description: "the notes" }]);
  });
});

describe("review findings: source kept and meaning kept", () => {
  test("a folded instruction keeps its paragraph breaks", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
`;
    for (const instruction of ["first paragraph\nsecond paragraph", "a\n\nb", "one\ntwo\n\n\nthree"]) {
      const out = applyEdit(t, { op: "setInstruction", step: 0, text: instruction, style: ">" });
      const parsed = parseWorkflowText(out);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      expect(parsed.workflow.steps[0].instruction).toBe(instruction);
      expect(out).toContain("instruction: >");
    }
  });

  test("adding an output to a single artifact mapping keeps its comments and lines", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces:
      # keep this artifact note
      artifact: first # keep inline
      path: first.md # keep path note
`;
    const out = applyEdit(t, { op: "addOutput", step: 0, mode: "produces", artifact: "second", path: "second.md" });
    for (const kept of ["# keep this artifact note", "artifact: first # keep inline", "path: first.md # keep path note"]) {
      expect(out).toContain(kept);
    }
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.workflow.steps[0].produces.map((a) => [a.artifact, a.path])).toEqual([
      ["first", "first.md"],
      ["second", "second.md"],
    ]);
  });

  test("adding a gate to a single gate mapping with several fields keeps it as written", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    gates:
      agent: review   # why
      description: Independent.
      max_rounds: 2
      route_back_to: a
`;
    const out = applyEdit(t, { op: "addGate", step: 0, gate: { kind: "check", text: "default" } });
    expect(out).toContain("agent: review   # why");
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.workflow.steps[0].gates).toEqual([
      { kind: "agent", text: "review", description: "Independent.", max_rounds: 2, route_back_to: ["a"] },
      { kind: "check", text: "default", route_back_to: [] },
    ]);
  });

  test("a single flow-mapping output and a single string gate become one-item lists unchanged", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces: { artifact: first, path: first.md }
    gates: script("bun test")
`;
    const withOutput = applyEdit(t, { op: "addOutput", step: 0, mode: "produces", artifact: "second", path: "second.md" });
    expect(withOutput).toContain("- { artifact: first, path: first.md }");
    const withGate = applyEdit(t, { op: "addGate", step: 0, gate: { kind: "check", text: "default" } });
    expect(withGate).toContain(`- script("bun test")`);
    for (const out of [withOutput, withGate]) {
      const parsed = parseWorkflowText(out);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    }
  });
});

describe("review round 2: edits keep the lines they don't change", () => {
  test("changing an output's mode moves its lines and comments as written", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces:
      - artifact: first
        path: first.md
      # about the second
      - artifact: second # keep inline
        path: second.md # keep path note
    updates:
      - artifact: code
        path: .
`;
    const out = applyEdit(t, { op: "changeOutputMode", step: 0, mode: "produces", index: 1, to: "updates" });
    for (const kept of ["# about the second", "artifact: second # keep inline", "path: second.md # keep path note"]) {
      expect(out).toContain(kept);
    }
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.workflow.steps[0].produces.map((a) => a.artifact)).toEqual(["first"]);
    expect(parsed.workflow.steps[0].updates.map((a) => a.artifact)).toEqual(["code", "second"]);
  });

  test("changing the mode of the only output creates the other key with its lines", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces:
      - artifact: only # note
        path: only.md
`;
    const out = applyEdit(t, { op: "changeOutputMode", step: 0, mode: "produces", index: 0, to: "optional_produces" });
    expect(out).toContain("artifact: only # note");
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.workflow.steps[0].produces).toEqual([]);
    expect(parsed.workflow.steps[0].optional_produces.map((a) => a.artifact)).toEqual(["only"]);
  });

  test("toggling consumes on a block list keeps the other items and their comments", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces: [{ artifact: one, path: one.md }, { artifact: two, path: two.md }, { artifact: three, path: three.md }]
  - id: b
    instruction: y
    consumes:
      - one # the first input
      - two
`;
    const removed = applyEdit(t, { op: "setConsumes", step: 1, ids: ["one"] });
    expect(removed).toBe(t.replace("      - two\n", ""));
    const added = applyEdit(t, { op: "setConsumes", step: 1, ids: ["one", "two", "three"] });
    expect(added).toBe(t.replace("      - two\n", "      - two\n      - three\n"));
    for (const out of [removed, added]) {
      const parsed = parseWorkflowText(out);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    }
  });

  test("changing a condition's kind keeps its description and comments", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    condition:
      # why this step is optional
      agent: when needed # inline
      description: d # about d
`;
    const out = applyEdit(t, { op: "setCondition", step: 0, condition: { kind: "owner-action", text: "ask the owner", description: "d" } });
    expect(out).toBe(t.replace("agent: when needed", "owner-action: ask the owner"));
  });
});

describe("review round 3: flow lists and empty lists", () => {
  const ok = (out: string) => {
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(`${JSON.stringify(parsed.issues)}\n${out}`);
    return parsed.workflow;
  };

  test("changing the mode of one entry of a flow list moves that entry only", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces: [{ artifact: first, path: first.md }, { artifact: second, path: second.md }]
    updates: [{ artifact: code, path: . }]
`;
    const w = ok(applyEdit(t, { op: "changeOutputMode", step: 0, mode: "produces", index: 0, to: "updates" }));
    expect(w.steps[0].produces.map((a) => a.artifact)).toEqual(["second"]);
    expect(w.steps[0].updates.map((a) => a.artifact)).toEqual(["code", "first"]);
  });

  test("moving an output into an empty flow list fills it", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces:
      - artifact: first # note
        path: first.md
      - artifact: second
        path: second.md
    updates: []
`;
    const out = applyEdit(t, { op: "changeOutputMode", step: 0, mode: "produces", index: 0, to: "updates" });
    expect(out).toContain("artifact: first # note");
    const w = ok(out);
    expect(w.steps[0].updates.map((a) => a.artifact)).toEqual(["first"]);
  });

  test("adding and removing on flow lists, and adding to gates: []", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces: [{ artifact: first, path: first.md }, { artifact: second, path: second.md }]
    gates: []
`;
    expect(ok(applyEdit(t, { op: "addOutput", step: 0, mode: "produces", artifact: "third", path: "third.md" })).steps[0].produces.map((a) => a.artifact)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(ok(applyEdit(t, { op: "removeOutput", step: 0, mode: "produces", index: 0 })).steps[0].produces.map((a) => a.artifact)).toEqual(["second"]);
    expect(ok(applyEdit(t, { op: "addGate", step: 0, gate: { kind: "check", text: "default" } })).steps[0].gates).toEqual([
      { kind: "check", text: "default", route_back_to: [] },
    ]);
  });

  test("a field edit on a flow entry stays on its line", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces: [{ artifact: first, path: first.md }]
`;
    expect(applyEdit(t, { op: "setOutput", step: 0, mode: "produces", index: 0, fields: { path: "other.md" } })).toBe(
      t.replace("path: first.md", "path: other.md"),
    );
    const described = applyEdit(t, { op: "setOutput", step: 0, mode: "produces", index: 0, fields: { description: "the first" } });
    expect(ok(described).steps[0].produces[0].description).toBe("the first");
  });

  test("the first step of an empty workflow replaces steps: []", () => {
    const t = `version: 1
name: x
steps: []
`;
    const out = applyEdit(t, { op: "insertStep", at: 0, step: { id: "a", instruction: "Do it." } });
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(`${JSON.stringify(parsed.issues)}\n${out}`);
    expect(parsed.workflow.steps.map((st) => st.id)).toEqual(["a"]);
  });
});

describe("review round 4: flow steps, step comments, flow gates", () => {
  const ok = (out: string) => {
    const parsed = parseWorkflowText(out);
    if (!parsed.ok) throw new Error(`${JSON.stringify(parsed.issues)}\n${out}`);
    return parsed.workflow;
  };
  const flowSteps = `version: 1
name: x
steps: [{ id: a, instruction: x }, { id: b, instruction: y }]
`;

  test("insert, delete and move work on steps written as a flow list", () => {
    expect(ok(applyEdit(flowSteps, { op: "insertStep", at: 1, step: { id: "n", instruction: "New." } })).steps.map((st) => st.id)).toEqual([
      "a",
      "n",
      "b",
    ]);
    expect(ok(applyEdit(flowSteps, { op: "deleteStep", index: 0 })).steps.map((st) => st.id)).toEqual(["b"]);
    expect(ok(applyEdit(flowSteps, { op: "moveStep", from: 1, to: 0 })).steps.map((st) => st.id)).toEqual(["b", "a"]);
    const one = `version: 1\nname: x\nsteps: [{ id: a, instruction: x }]\n`;
    expect(ok(applyEdit(one, { op: "insertStep", at: 0, step: { id: "n", instruction: "New." } })).steps.map((st) => st.id)).toEqual(["n", "a"]);
  });

  const commented = `version: 1
name: x
steps:
  # comment for a
  - id: a
    instruction: x
  # comment for b
  - id: b # inline b
    instruction: y
  # comment for c
  - id: c
    instruction: z
`;

  test("a moved step takes the comments directly above it", () => {
    const out = applyEdit(commented, { op: "moveStep", from: 1, to: 0 });
    expect(out).toBe(`version: 1
name: x
steps:
  # comment for b
  - id: b # inline b
    instruction: y
  # comment for a
  - id: a
    instruction: x
  # comment for c
  - id: c
    instruction: z
`);
    const last = applyEdit(commented, { op: "moveStep", from: 0, to: 2 });
    expect(ok(last).steps.map((st) => st.id)).toEqual(["b", "c", "a"]);
    expect(last.endsWith("  # comment for a\n  - id: a\n    instruction: x\n")).toBe(true);
  });

  test("a deleted step takes the comments directly above it", () => {
    expect(applyEdit(commented, { op: "deleteStep", index: 1 })).toBe(commented.replace("  # comment for b\n  - id: b # inline b\n    instruction: y\n", ""));
  });

  test("editing one gate of a flow list rewrites that gate only", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    gates: [{ agent: review, max_rounds: 2 }, { check: default }] # keep layout
`;
    expect(applyEdit(t, { op: "setGate", step: 0, index: 0, fields: { max_rounds: 3 } })).toBe(t.replace("max_rounds: 2", "max_rounds: 3"));
    const routed = applyEdit(t, { op: "setGate", step: 0, index: 1, fields: { route_back_to: ["a"] } });
    expect(routed).toBe(t.replace("{ check: default }", "{ check: default, route_back_to: a }"));
    expect(ok(routed).steps[0].gates[1].route_back_to).toEqual(["a"]);
  });
});

describe("review round 5: which comments belong to a list item", () => {
  const steps = `version: 1
name: x
steps:
  - id: a
    instruction: x
    # note about a
  # comment for b
  - id: b
    instruction: y
`;

  test("a comment indented as a field stays with the step above; one at the dash goes with the step below", () => {
    expect(applyEdit(steps, { op: "deleteStep", index: 1 })).toBe(`version: 1
name: x
steps:
  - id: a
    instruction: x
    # note about a
`);
    const inserted = applyEdit(steps, { op: "insertStep", at: 1, step: { id: "n", instruction: "New." } });
    expect(inserted.indexOf("# note about a")).toBeLessThan(inserted.indexOf("- id: n"));
    expect(inserted.indexOf("- id: n")).toBeLessThan(inserted.indexOf("# comment for b"));
    const moved = applyEdit(steps, { op: "moveStep", from: 1, to: 0 });
    expect(moved).toBe(`version: 1
name: x
steps:
  # comment for b
  - id: b
    instruction: y
  - id: a
    instruction: x
    # note about a
`);
  });

  test("removing a consumes id, an output or a gate removes the comment above it too", () => {
    const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    produces:
      - artifact: one
        path: one.md
      # about two
      - artifact: two
        path: two.md
  - id: b
    instruction: y
    consumes:
      - one
      # belongs to two
      - two
    gates:
      - check: default
      # about the owner
      - owner-action: approve
`;
    expect(applyEdit(t, { op: "setConsumes", step: 1, ids: ["one"] })).toBe(t.replace("      # belongs to two\n      - two\n", ""));
    expect(applyEdit(t, { op: "removeOutput", step: 0, mode: "produces", index: 1 })).toBe(
      t.replace("      # about two\n      - artifact: two\n        path: two.md\n", ""),
    );
    expect(applyEdit(t, { op: "removeGate", step: 1, index: 1 })).toBe(t.replace("      # about the owner\n      - owner-action: approve\n", ""));
  });
});

describe("condition mappings", () => {
  const t = `version: 1
name: x
steps:
  - id: a
    instruction: x
    condition:
      agent: when needed   # keep me
      description: d
`;
  test("a text or description change keeps the other lines and comments", () => {
    expect(applyEdit(t, { op: "setCondition", step: 0, condition: { kind: "agent", text: "when really needed", description: "d" } })).toBe(
      t.replace("agent: when needed", "agent: when really needed"),
    );
    expect(applyEdit(t, { op: "setCondition", step: 0, condition: { kind: "agent", text: "when needed" } })).toBe(
      t.replace("      description: d\n", ""),
    );
  });
});

describe("gates", () => {
  const commented = `version: 1
name: x
steps:
  - id: a
    instruction: x
    gates:
      - agent: review it   # why this review
        max_rounds: 2
        # the target
        route_back_to: a
`;

  test("setGate changes only the keys that changed, keeping order and comments", () => {
    expect(applyEdit(commented, { op: "setGate", step: 0, index: 0, fields: { text: "review again" } })).toBe(
      commented.replace("agent: review it", "agent: review again"),
    );
    expect(applyEdit(commented, { op: "setGate", step: 0, index: 0, fields: { max_rounds: 3 } })).toBe(
      commented.replace("max_rounds: 2", "max_rounds: 3"),
    );
    expect(applyEdit(commented, { op: "setGate", step: 0, index: 0, fields: { description: "Independent." } })).toBe(
      commented.replace("   # why this review\n", "   # why this review\n        description: Independent.\n"),
    );
    expect(applyEdit(commented, { op: "setGate", step: 0, index: 0, fields: { route_back_to: [] } })).toBe(
      commented.replace("        route_back_to: a\n", ""),
    );
  });

  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
  - id: two
    instruction: Review.
    gates:
      - check: default
`;

  test("addGate on a step with none creates the key", () => {
    const edited = applyEdit(text, { op: "addGate", step: 0, gate: { kind: "owner-action", text: "approve" } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].gates).toEqual([{ kind: "owner-action", text: "approve", route_back_to: [] }]);
  });

  test("addGate on a single gate converts it to a list", () => {
    const edited = applyEdit(text, { op: "addGate", step: 1, gate: { kind: "owner-action", text: "approve" } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.workflow.steps[1].gates).toEqual([
        { kind: "check", text: "default", route_back_to: [] },
        { kind: "owner-action", text: "approve", route_back_to: [] },
      ]);
  });

  test("removeGate removes the only gate and the key", () => {
    const edited = applyEdit(text, { op: "removeGate", step: 1, index: 0 });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[1].gates).toEqual([]);
    expect(edited).not.toContain("gates:");
  });

  test("setGate changes kind away from agent, dropping max_rounds and guide", () => {
    const withAgent = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
    gates:
      - agent: review it
        max_rounds: 3
        guide: review.md
`;
    const edited = applyEdit(withAgent, { op: "setGate", step: 0, index: 0, fields: { kind: "check", text: "default" } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps[0].gates).toEqual([{ kind: "check", text: "default", route_back_to: [] }]);
    expect(edited).not.toContain("max_rounds");
    expect(edited).not.toContain("guide:");
  });

  test("setGate sets and clears max_rounds", () => {
    const withAgent = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
    gates:
      - agent: review it
`;
    const withRounds = applyEdit(withAgent, { op: "setGate", step: 0, index: 0, fields: { max_rounds: 3 } });
    const parsed1 = parseWorkflowText(withRounds);
    expect(parsed1.ok).toBe(true);
    if (parsed1.ok) expect(parsed1.workflow.steps[0].gates[0].max_rounds).toBe(3);

    const cleared = applyEdit(withRounds, { op: "setGate", step: 0, index: 0, fields: { max_rounds: null } });
    const parsed2 = parseWorkflowText(cleared);
    expect(parsed2.ok).toBe(true);
    if (parsed2.ok) expect(parsed2.workflow.steps[0].gates[0].max_rounds).toBeUndefined();
  });

  test("route_back_to: one, many, none", () => {
    const withTwoSteps = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
  - id: two
    instruction: Also.
  - id: three
    instruction: Review.
    gates:
      - agent: review
`;
    const oneTarget = applyEdit(withTwoSteps, { op: "setGate", step: 2, index: 0, fields: { route_back_to: ["one"] } });
    const parsed1 = parseWorkflowText(oneTarget);
    expect(parsed1.ok).toBe(true);
    if (parsed1.ok) expect(parsed1.workflow.steps[2].gates[0].route_back_to).toEqual(["one"]);
    expect(oneTarget).toContain("route_back_to: one\n");

    const twoTargets = applyEdit(withTwoSteps, { op: "setGate", step: 2, index: 0, fields: { route_back_to: ["one", "two"] } });
    const parsed2 = parseWorkflowText(twoTargets);
    expect(parsed2.ok).toBe(true);
    if (parsed2.ok) expect(parsed2.workflow.steps[2].gates[0].route_back_to).toEqual(["one", "two"]);
    expect(twoTargets).toContain("route_back_to: [one, two]");

    const removed = applyEdit(oneTarget, { op: "setGate", step: 2, index: 0, fields: { route_back_to: [] } });
    const parsed3 = parseWorkflowText(removed);
    expect(parsed3.ok).toBe(true);
    if (parsed3.ok) expect(parsed3.workflow.steps[2].gates[0].route_back_to).toEqual([]);
    expect(removed).not.toContain("route_back_to");
  });

  test("a string-form gate stays untouched until it is edited, then becomes a mapping", () => {
    const stringGate = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
    gates:
      - 'script("bun run check")'
      - check: default
`;
    const editOther = applyEdit(stringGate, { op: "setGate", step: 0, index: 1, fields: { text: "lint" } });
    expect(editOther).toContain('script("bun run check")');
    const parsedOther = parseWorkflowText(editOther);
    expect(parsedOther.ok).toBe(true);
    if (parsedOther.ok) {
      expect(parsedOther.workflow.steps[0].gates[0]).toEqual({ kind: "script", text: "bun run check", route_back_to: [] });
      expect(parsedOther.workflow.steps[0].gates[1]).toEqual({ kind: "check", text: "lint", route_back_to: [] });
    }

    const editItself = applyEdit(stringGate, { op: "setGate", step: 0, index: 0, fields: { text: "bun run check2" } });
    expect(editItself).not.toContain('script("bun run check")');
    expect(editItself).toContain("script: bun run check2");
    const parsedSelf = parseWorkflowText(editItself);
    expect(parsedSelf.ok).toBe(true);
    if (parsedSelf.ok) expect(parsedSelf.workflow.steps[0].gates[0]).toEqual({ kind: "script", text: "bun run check2", route_back_to: [] });
  });
});

describe("insertStep, deleteStep, moveStep", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: First.
  - id: two
    # a comment on two
    instruction: Second.
  - id: three
    instruction: Third.
`;

  test("insertStep at the start", () => {
    const edited = applyEdit(text, { op: "insertStep", at: 0, step: { id: "zero", instruction: "Zeroth." } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.steps.map((s) => s.id)).toEqual(["zero", "one", "two", "three"]);
      expect(parsed.workflow.steps[0].instruction).toBe("Zeroth.");
    }
  });

  test("insertStep in the middle", () => {
    const edited = applyEdit(text, { op: "insertStep", at: 1, step: { id: "onepointfive", instruction: "In between." } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps.map((s) => s.id)).toEqual(["one", "onepointfive", "two", "three"]);
  });

  test("insertStep at the end", () => {
    const edited = applyEdit(text, { op: "insertStep", at: 3, step: { id: "four", instruction: "Fourth." } });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps.map((s) => s.id)).toEqual(["one", "two", "three", "four"]);
  });

  test("deleteStep removes a step and its comments", () => {
    const edited = applyEdit(text, { op: "deleteStep", index: 1 });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps.map((s) => s.id)).toEqual(["one", "three"]);
    expect(edited).not.toContain("a comment on two");
  });

  test("moveStep carries its own comments and lines with it", () => {
    const edited = applyEdit(text, { op: "moveStep", from: 1, to: 0 });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps.map((s) => s.id)).toEqual(["two", "one", "three"]);
    expect(edited).toContain("# a comment on two");
  });

  test("moveStep to a later position", () => {
    const edited = applyEdit(text, { op: "moveStep", from: 0, to: 2 });
    const parsed = parseWorkflowText(edited);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workflow.steps.map((s) => s.id)).toEqual(["two", "three", "one"]);
  });

  test("moveStep to the same position is a no-op", () => {
    const edited = applyEdit(text, { op: "moveStep", from: 1, to: 1 });
    expect(edited).toBe(text);
  });
});

describe("errors", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: Do it.
`;

  test("throws a clear error for an out-of-range step", () => {
    expect(() => applyEdit(text, { op: "setStepField", step: 5, key: "title", value: "x" })).toThrow(/step/i);
  });

  test("throws a clear error for a duplicate id on rename", () => {
    const two = `version: 1
name: demo
steps:
  - id: one
    instruction: First.
  - id: two
    instruction: Second.
`;
    expect(() => applyEdit(two, { op: "setStepField", step: 0, key: "id", value: "two" })).toThrow();
  });
});

// Satisfy the type checker that Edit is exported and usable by callers.
const _typeCheck: Edit = { op: "setWorkflowField", key: "name", value: "x" };
void _typeCheck;

describe("semantic no-ops", () => {
  const text = `version: 1
name: demo
steps:
  - id: one
    instruction: Produce.
    produces:
      - artifact: notes
        path: notes.md
  - id: two
    instruction: >
      Review.
    condition:
      agent: only when needed
      description: judgment call
    consumes: [notes]
    produces:
      - artifact: report
        path: report.md
    gates:
      - agent: review
        max_rounds: 2
        route_back_to: one
`;

  test("return the identical source across editable structured fields", () => {
    const edits: Edit[] = [
      { op: "setInstruction", step: 1, text: "Review.", style: ">" },
      { op: "setCondition", step: 1, condition: { kind: "agent", text: "only when needed", description: "judgment call" } },
      { op: "setConsumes", step: 1, ids: ["notes"] },
      { op: "setOutput", step: 1, mode: "produces", index: 0, fields: { path: "report.md" } },
      { op: "changeOutputMode", step: 1, mode: "produces", index: 0, to: "produces" },
      { op: "setGate", step: 1, index: 0, fields: { text: "review", max_rounds: 2, route_back_to: ["one"] } },
    ];
    for (const edit of edits) expect(applyEdit(text, edit)).toBe(text);
  });
});
