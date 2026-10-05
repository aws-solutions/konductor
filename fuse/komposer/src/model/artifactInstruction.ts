// SPDX-License-Identifier: Apache-2.0
// Adding an artifact to a step, with the step's instruction pre-filled from the
// library's description of the artifact (decision 18 of the Komposer build
// spec). An empty instruction becomes "Write the <id>: <description>". An
// instruction that is still nothing but such lines, for artifacts the step
// already has, gets one more line. Any other instruction is the author's and
// is left alone.

import YAML from "yaml";
import { applyEdit, type Edit, type OutputMode } from "./yamlEdit.ts";

// The library's description of an artifact id, if it has one.
export type Describe = (id: string) => string | undefined;

// What this module needs of a library entry, as the library listing gives it.
export interface DescribedEntry {
  id: string;
  level: "project" | "user" | "package";
  description?: string;
}

// The entry an artifact id resolves to: project, then personal, then package.
// The most specific entry wins as a whole (decision 24 of the schema redesign).
export function winningEntry<E extends DescribedEntry>(entries: E[], artifactId: string): E | undefined {
  const order: DescribedEntry["level"][] = ["project", "user", "package"];
  return order.map((level) => entries.find((e) => e.id === artifactId && e.level === level)).find(Boolean);
}

// Descriptions come from the winning entry only: a project entry without one
// does not borrow the package's.
export const describeFrom =
  (entries: DescribedEntry[]): Describe =>
  (artifactId) =>
    winningEntry(entries, artifactId)?.description;

const MODES: OutputMode[] = ["produces", "optional_produces", "updates"];

const verb = (mode: OutputMode) => (mode === "updates" ? "Update" : "Write");

// "The architecture ..." reads as "Write the design: the architecture ...".
// A leading acronym such as "README ..." keeps its case.
function lowerFirst(text: string): string {
  return /^[A-Z][^A-Z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

export function instructionLine(mode: OutputMode, id: string, description: string | undefined): string {
  // One line per artifact, whatever line breaks the description was written with.
  const sentence = description?.trim().replace(/\s+/g, " ");
  return sentence ? `${verb(mode)} the ${id}: ${lowerFirst(sentence)}` : `${verb(mode)} the ${id}.`;
}

interface StepState {
  instruction: string;
  outputs: { mode: OutputMode; id: string }[];
}

function readStep(text: string, step: number): StepState {
  const parsed = YAML.parse(text) as { steps?: Record<string, unknown>[] } | null;
  const s = parsed?.steps?.[step];
  if (!s) throw new Error(`no step at index ${step}`);
  const outputs = MODES.flatMap((mode) => {
    const value = s[mode];
    const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
    return list.flatMap((a) =>
      a && typeof a === "object" && typeof (a as { artifact?: unknown }).artifact === "string"
        ? [{ mode, id: (a as { artifact: string }).artifact }]
        : [],
    );
  });
  return { instruction: typeof s.instruction === "string" ? s.instruction : "", outputs };
}

// The lines of an instruction that is empty or only generated lines for the
// step's own artifacts; undefined when the author has written anything else.
function generatedLines(state: StepState, describe: Describe): string[] | undefined {
  const lines = state.instruction
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Each output's own verb: a line whose verb the author changed is the author's.
  const known = new Set(state.outputs.map(({ mode, id }) => instructionLine(mode, id, describe(id))));
  return lines.every((l) => known.has(l)) ? lines : undefined;
}

// The edits that add an artifact to a step and, when the instruction is still
// generated, extend it. Apply them in order with applyEdit.
export function addArtifactEdits(
  text: string,
  step: number,
  mode: OutputMode,
  artifact: string,
  path: string,
  describe: Describe,
): Edit[] {
  const state = readStep(text, step);
  const edits: Edit[] = [{ op: "addOutput", step, mode, artifact, path }];
  const lines = generatedLines(state, describe);
  if (!lines) return edits;
  const line = instructionLine(mode, artifact, describe(artifact));
  if (lines.includes(line)) return edits;
  const next = [...lines, line];
  // One line folds; several stay one per line.
  edits.push({ op: "setInstruction", step, text: next.join("\n"), style: next.length === 1 ? ">" : "|" });
  return edits;
}

// The edits that insert a new step at `at` built around one artifact: its id
// from the artifact (made unique), the artifact as its output, and the
// pre-filled instruction.
export function insertArtifactStepEdits(
  text: string,
  at: number,
  artifact: string,
  path: string,
  describe: Describe,
): Edit[] {
  const parsed = YAML.parse(text) as { steps?: { id?: unknown }[] } | null;
  const taken = new Set((parsed?.steps ?? []).map((s) => s?.id));
  let id = artifact;
  for (let n = 2; taken.has(id); n++) id = `${artifact}-${n}`;
  const insert: Edit = { op: "insertStep", at, step: { id, instruction: "" } };
  return [insert, ...addArtifactEdits(applyEdit(text, insert), at, "produces", artifact, path, describe)];
}
