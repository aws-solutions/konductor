// SPDX-License-Identifier: Apache-2.0
// End-to-end tests of the instruction pre-fill (decision 18): real workflow
// text, the edits applied with applyEdit, the result read back with the
// engine's own parser. The descriptions are the shipped library's entry.yml
// files. No mocks of our own code.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { parseWorkflowText } from "../../flow/src/parse.ts";
import { listLibrary } from "../../flow/src/policy.ts";
import {
  addArtifactEdits,
  describeFrom,
  insertArtifactStepEdits,
  type Describe,
} from "../src/model/artifactInstruction.ts";
import { applyEdit, type Edit } from "../src/model/yamlEdit.ts";

const FLOW = resolve(import.meta.dir, "..", "..", "flow");
const LIBRARY = join(FLOW, "library", "artifacts");
const SHIPPED = Object.fromEntries(
  readdirSync(LIBRARY)
    .filter((id) => existsSync(join(LIBRARY, id, "entry.yml")))
    .map((id) => [id, YAML.parse(readFileSync(join(LIBRARY, id, "entry.yml"), "utf8")).description as string]),
);
const describeShipped: Describe = (id) => SHIPPED[id];

const DESIGN = "the architecture and the decisions behind it, with every claim about current behaviour cited to the code.";
const SPLIT = "the design split into features that can be built independently, each with a unique slug.";

const BASE = `version: 1
name: demo
steps:
  # the first step
  - id: draft
    instruction: >
      Draft it by hand.
  - id: empty
    instruction: ""
`;

const applyAll = (text: string, edits: Edit[]) => edits.reduce(applyEdit, text);

// One step as written. BASE's "empty" step is invalid until an edit fills
// it, so tests that fill it check the whole file with `valid`.
function step(text: string, index: number) {
  const s = YAML.parse(text).steps[index];
  return { ...s, produces: s.produces === undefined ? [] : [s.produces].flat() };
}

function valid(text: string) {
  const parsed = parseWorkflowText(text);
  expect(parsed.ok ? [] : parsed.issues).toEqual([]);
}

describe("adding an artifact to a step", () => {
  test("an empty instruction becomes 'Write the <id>: <description>'", () => {
    const out = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", "design", "docs/{slug}.md", describeShipped));
    expect(step(out, 1).instruction.trim()).toBe(`Write the design: ${DESIGN}`);
    expect(step(out, 1).produces.map((a: any) => a.artifact)).toEqual(["design"]);
    valid(out);
    // The other step and its comment are untouched.
    expect(out.startsWith(BASE.slice(0, BASE.indexOf("  - id: empty")))).toBe(true);
  });

  test("an instruction that is only generated lines gets one line per artifact", () => {
    let text = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", "design", "docs/{slug}.md", describeShipped));
    text = applyAll(text, addArtifactEdits(text, 1, "produces", "feature-split", "docs/{slug}-split.md", describeShipped));
    text = applyAll(text, addArtifactEdits(text, 1, "updates", "code", ".", describeShipped));
    // A generated "Update" line is recognised too, so the next artifact still extends.
    text = applyAll(text, addArtifactEdits(text, 1, "produces", "notes", "n.md", describeShipped));
    valid(text);
    // A literal block, so the lines stay one per line in the file too.
    expect(text).toContain(`instruction: |\n      Write the design: ${DESIGN}\n      Write the feature-split: `);
    expect(step(text, 1).instruction.trimEnd().split("\n")).toEqual([
      `Write the design: ${DESIGN}`,
      `Write the feature-split: ${SPLIT}`,
      `Update the code: ${SHIPPED.code[0].toLowerCase()}${SHIPPED.code.slice(1)}`,
      "Write the notes.",
    ]);
  });

  test("an instruction the author wrote is left alone", () => {
    const out = applyAll(BASE, addArtifactEdits(BASE, 0, "produces", "design", "docs/{slug}.md", describeShipped));
    expect(step(out, 0).instruction.trim()).toBe("Draft it by hand.");
    expect(step(out, 0).produces.map((a: any) => a.artifact)).toEqual(["design"]);
  });

  test("an edited generated line counts as the author's", () => {
    let text = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", "design", "docs/{slug}.md", describeShipped));
    text = applyEdit(text, { op: "setInstruction", step: 1, text: `Write the design: ${DESIGN} Keep it short.`, style: ">" });
    const out = applyAll(text, addArtifactEdits(text, 1, "produces", "feature-split", "x.md", describeShipped));
    expect(step(out, 1).instruction.trim()).toBe(`Write the design: ${DESIGN} Keep it short.`);
  });

  test("changing a generated line's verb counts as the author's", () => {
    let text = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", "design", "docs/{slug}.md", describeShipped));
    text = applyEdit(text, { op: "setInstruction", step: 1, text: `Update the design: ${DESIGN}`, style: ">" });
    const out = applyAll(text, addArtifactEdits(text, 1, "produces", "feature-split", "x.md", describeShipped));
    expect(out.replace(/\n  +produces:[\s\S]*$/, "")).toBe(text.replace(/\n  +produces:[\s\S]*$/, ""));
    expect(step(out, 1).instruction.trim()).toBe(`Update the design: ${DESIGN}`);
  });

  test("a generated line whose output changed mode counts as the author's", () => {
    for (const [from, to, verb] of [
      ["produces", "updates", "Write"],
      ["updates", "produces", "Update"],
    ] as const) {
      let text = applyAll(BASE, addArtifactEdits(BASE, 1, from, "design", "d.md", describeShipped));
      text = applyEdit(text, { op: "changeOutputMode", step: 1, mode: from, index: 0, to });
      const out = applyAll(text, addArtifactEdits(text, 1, "produces", "notes", "n.md", describeShipped));
      expect(step(out, 1).instruction.trim()).toBe(`${verb} the design: ${DESIGN}`);
      expect(step(out, 1).produces.map((a: any) => a.artifact)).toContain("notes");
    }
  });

  test("a generated line for an artifact the step no longer has counts as the author's", () => {
    let text = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", "design", "docs/{slug}.md", describeShipped));
    text = applyEdit(text, { op: "removeOutput", step: 1, mode: "produces", index: 0 });
    const out = applyAll(text, addArtifactEdits(text, 1, "produces", "feature-split", "x.md", describeShipped));
    expect(step(out, 1).instruction.trim()).toBe(`Write the design: ${DESIGN}`);
  });

  test("an output that may be produced is written like one that is", () => {
    let text = applyAll(BASE, addArtifactEdits(BASE, 1, "optional_produces", "design", "d.md", describeShipped));
    text = applyAll(text, addArtifactEdits(text, 1, "optional_produces", "feature-split", "s.md", describeShipped));
    valid(text);
    expect(YAML.parse(text).steps[1].optional_produces.map((a: any) => a.artifact)).toEqual(["design", "feature-split"]);
    expect(step(text, 1).instruction.trimEnd().split("\n")).toEqual([
      `Write the design: ${DESIGN}`,
      `Write the feature-split: ${SPLIT}`,
    ]);
    const authored = applyAll(BASE, addArtifactEdits(BASE, 0, "optional_produces", "design", "d.md", describeShipped));
    expect(step(authored, 0).instruction.trim()).toBe("Draft it by hand.");
  });

  test("a comment on the instruction's line survives the pre-fill and its extension", () => {
    const commented = BASE.replace('    instruction: ""\n', '    instruction: "" # keep this comment\n');
    let text = applyAll(commented, addArtifactEdits(commented, 1, "produces", "notes", "n.md", describeShipped));
    text = applyAll(text, addArtifactEdits(text, 1, "produces", "design", "d.md", describeShipped));
    valid(text);
    expect(text).toContain("    instruction: | # keep this comment\n");
    expect(step(text, 1).instruction.trimEnd().split("\n")).toEqual(["Write the notes.", `Write the design: ${DESIGN}`]);
  });

  test("an artifact with no description gets 'Write the <id>.'", () => {
    const out = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", "notes", "notes.md", describeShipped));
    expect(step(out, 1).instruction.trim()).toBe("Write the notes.");
  });
});

describe("dropping a library entry between steps", () => {
  test("creates a step named after the artifact, with the output and the pre-filled instruction", () => {
    const out = applyAll(BASE, insertArtifactStepEdits(BASE, 1, "design", "docs/{slug}.md", describeShipped));
    const inserted = step(out, 1);
    expect(inserted.id).toBe("design");
    expect(inserted.instruction.trim()).toBe(`Write the design: ${DESIGN}`);
    expect(inserted.produces).toEqual([{ artifact: "design", path: "docs/{slug}.md" }]);
    expect(step(out, 0).id).toBe("draft");
    expect(step(out, 2).id).toBe("empty");
    expect(out.slice(0, out.indexOf("  - id: design"))).toBe(BASE.slice(0, BASE.indexOf("  - id: empty")));
  });

  test("makes the step id unique", () => {
    let text = applyAll(BASE, insertArtifactStepEdits(BASE, 2, "design", "a.md", describeShipped));
    text = applyAll(text, insertArtifactStepEdits(text, 3, "design", "b.md", describeShipped));
    expect([step(text, 2).id, step(text, 3).id]).toEqual(["design", "design-2"]);
  });

  test("every shipped entry dropped into _k-full-sdlc gives a workflow with no problems", () => {
    const full = readFileSync(join(FLOW, "workflows", "_k-full-sdlc.yml"), "utf8");
    for (const id of Object.keys(SHIPPED)) {
      const out = applyAll(full, insertArtifactStepEdits(full, 0, id, `.konductor/{slug}/${id}-new.md`, describeShipped));
      const parsed = parseWorkflowText(out);
      expect({ id, issues: parsed.ok ? [] : parsed.issues }).toEqual({ id, issues: [] });
      if (parsed.ok) expect(parsed.workflow.steps[0].instruction.trim()).toStartWith(`Write the ${id}: `);
    }
  });
});

describe("which entry's description is used", () => {
  const dirs: string[] = [];
  const savedHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = savedHome;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function entry(base: string, id: string, description?: string) {
    const folder = join(base, ".konductor", "library", "artifacts", id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "guide.md"), "guide\n");
    if (description) writeFileSync(join(folder, "entry.yml"), `description: ${JSON.stringify(description)}\n`);
  }
  // The engine's own listing of a throwaway project and home, then the pre-fill.
  function filled(setup: (root: string, home: string) => void, id: string): string {
    const root = mkdtempSync(join(tmpdir(), "kp-desc-root-"));
    const home = mkdtempSync(join(tmpdir(), "kp-desc-home-"));
    dirs.push(root, home);
    process.env.HOME = home;
    setup(root, home);
    const describe = describeFrom(listLibrary(root));
    let out = applyAll(BASE, addArtifactEdits(BASE, 1, "produces", id, "x.md", describe));
    // A second artifact must extend the line just generated, whatever its description looks like.
    out = applyAll(out, addArtifactEdits(out, 1, "produces", "zz-extra", "z.md", describe));
    const lines = step(out, 1).instruction.trimEnd().split("\n");
    expect(lines[1]).toBe("Write the zz-extra.");
    return lines[0];
  }

  test("the project's entry wins over the user's and the package's", () => {
    const got = filled((root, home) => {
      entry(home, "design", "The user's design.");
      entry(root, "design", "The project's design.");
    }, "design");
    expect(got).toBe("Write the design: the project's design.");
  });

  test("the user's entry wins over the package's", () => {
    expect(filled((_root, home) => entry(home, "design", "The user's design."), "design")).toBe(
      "Write the design: the user's design.",
    );
  });

  test("the package's entry applies when no other level has the id", () => {
    expect(filled(() => {}, "design")).toBe(`Write the design: ${DESIGN}`);
  });

  test("a description written over several lines still extends", () => {
    const got = filled((root) => {
      const folder = join(root, ".konductor", "library", "artifacts", "notes");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "entry.yml"), "description: |\n  The notes\n  kept while working.\n");
    }, "notes");
    expect(got).toBe("Write the notes: the notes kept while working.");
  });

  test("a winning entry without a description does not borrow the package's", () => {
    expect(filled((root) => entry(root, "design"), "design")).toBe("Write the design.");
  });
});
