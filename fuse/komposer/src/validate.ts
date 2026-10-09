// SPDX-License-Identifier: Apache-2.0
// Komposer never restates workflow rules. The engine parses and validates the
// current text; this module only translates its issue paths/codes into UI field
// locations and Komposer's reader-facing wording.

import YAML from "yaml";
import { parseWorkflowText, type WorkflowIssue } from "../../flow/src/parse.ts";

export type ProblemField = "name" | "steps" | "id" | "instr" | "cond" | "consumes" | "art" | "gate";
export interface Problem {
  stepIndex: number;
  field: ProblemField;
  itemIndex?: number;
  subfield?: "text" | "route" | "maxRounds";
  message: string;
}

function raw(text: string): Record<string, unknown> {
  try {
    const value = YAML.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
function rawSteps(doc: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(doc.steps)
    ? doc.steps.filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    : [];
}
function entryAt(value: unknown, index: number | undefined): unknown {
  if (index === undefined) return value;
  return Array.isArray(value) ? value[index] : index === 0 ? value : undefined;
}
function outputIndex(step: Record<string, unknown>, key: string, local: number | undefined): number | undefined {
  if (local === undefined) return undefined;
  const keys = ["produces", "optional_produces", "updates"];
  let n = local;
  for (const k of keys) {
    if (k === key) return n;
    const v = step[k];
    n += Array.isArray(v) ? v.length : v === undefined ? 0 : 1;
  }
  return n;
}

function translate(issue: WorkflowIssue, doc: Record<string, unknown>): Problem {
  const p = issue.path;
  if (!p.length) return { stepIndex: -1, field: "steps", message: issue.message };
  if (p[0] === "name") return { stepIndex: -1, field: "name", message: "Name is required." };
  if (p[0] === "steps" && p.length === 1)
    return { stepIndex: -1, field: "steps", message: "A workflow needs at least one step." };
  if (p[0] !== "steps" || typeof p[1] !== "number") return { stepIndex: -1, field: "steps", message: issue.message };
  const stepIndex = p[1];
  const step = rawSteps(doc)[stepIndex] ?? {};
  const key = p[2];
  if (key === "id") {
    if (/duplicate step id/.test(issue.message)) {
      const id = String(step.id ?? "");
      const first = rawSteps(doc).findIndex((s) => s.id === id);
      return { stepIndex, field: "id", message: `Id already used by step ${first + 1}.` };
    }
    return { stepIndex, field: "id", message: "Id: lower-case letters, digits and hyphens." };
  }
  if (key === "instruction") return { stepIndex, field: "instr", message: "Instruction is empty." };
  if (key === "condition") {
    return {
      stepIndex,
      field: "cond",
      message: /check names a kind/.test(issue.message)
        ? "A check is one lower-case word."
        : /needs a text/.test(issue.message)
          ? "Condition has no text."
          : issue.message,
    };
  }
  if (key === "consumes") {
    const itemIndex = typeof p[3] === "number" ? p[3] : undefined;
    const id = String(entryAt(step.consumes, itemIndex) ?? "");
    const later = rawSteps(doc).findIndex(
      (s, i) =>
        i > stepIndex &&
        ["produces", "optional_produces", "updates"].some((k) => {
          const values = s[k] === undefined ? [] : Array.isArray(s[k]) ? (s[k] as unknown[]) : [s[k]];
          return values.some((a) => !!a && typeof a === "object" && (a as Record<string, unknown>).artifact === id);
        }),
    );
    return {
      stepIndex,
      field: "consumes",
      itemIndex,
      message:
        later >= 0
          ? `\`${id}\` is produced by a later step (${later + 1}).`
          : `\`${id}\` is not produced or updated by an earlier step.`,
    };
  }
  if (key === "produces" || key === "optional_produces" || key === "updates") {
    const local = typeof p[3] === "number" ? p[3] : 0;
    const item = entryAt(step[key], local) as Record<string, unknown> | undefined;
    const itemIndex = outputIndex(step, key, local);
    return {
      stepIndex,
      field: "art",
      itemIndex,
      message:
        p[4] === "path"
          ? `\`${String(item?.artifact ?? "artifact")}\` has no path.`
          : "Artifact id: lower-case letters, digits and hyphens.",
    };
  }
  if (key === "gates") {
    const itemIndex = typeof p[3] === "number" ? p[3] : 0;
    const gate = entryAt(step.gates, itemIndex) as Record<string, unknown> | undefined;
    if (p[4] === "route_back_to" || /routes back/.test(issue.message)) {
      const routes = gate?.route_back_to;
      const fromMessage = issue.message.match(/routes back to "([^"]+)"/)?.[1];
      const target = fromMessage ?? (Array.isArray(routes) ? routes[0] : routes);
      const found = rawSteps(doc).findIndex((s) => s.id === target);
      return {
        stepIndex,
        field: "gate",
        itemIndex,
        subfield: "route",
        message:
          found < 0
            ? `Route back to ${String(target ?? "")}: no such step.`
            : `Route back to ${String(target ?? "")}: a later step.`,
      };
    }
    if (p[4] === "max_rounds" || /max_rounds/.test(issue.message))
      return {
        stepIndex,
        field: "gate",
        itemIndex,
        subfield: "maxRounds",
        message: "max_rounds is a whole number, at least 1.",
      };
    if (/check names a kind/.test(issue.message))
      return { stepIndex, field: "gate", itemIndex, subfield: "text", message: "A check is one lower-case word." };
    if (/needs a text/.test(issue.message)) {
      const kind = gate
        ? Object.keys(gate).find((k) => ["check", "script", "agent", "owner-action"].includes(k))
        : undefined;
      return { stepIndex, field: "gate", itemIndex, subfield: "text", message: `${kind ?? "Gate"} gate has no text.` };
    }
    return { stepIndex, field: "gate", itemIndex, message: issue.message };
  }
  return { stepIndex, field: "id", message: issue.message };
}

export function problemsForText(text: string): Problem[] {
  const result = parseWorkflowText(text);
  if (result.ok) return [];
  const doc = raw(text);
  return result.issues.map((issue) => translate(issue, doc));
}
export function problemsByStep(problems: Problem[]): Map<number, Problem[]> {
  const out = new Map<number, Problem[]>();
  for (const problem of problems) {
    if (problem.stepIndex < 0) continue;
    const list = out.get(problem.stepIndex) ?? [];
    list.push(problem);
    out.set(problem.stepIndex, list);
  }
  return out;
}
