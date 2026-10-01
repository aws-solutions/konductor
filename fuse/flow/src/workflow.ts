// SPDX-License-Identifier: Apache-2.0
// A workflow definition: which steps exist, in which order they run, and what
// closes each one. fuse-flow only reads it.

import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { FlowError } from "./errors.ts";

// What must hold before a step counts as done, besides its artifacts existing.
// A step has 0..n gates, in any combination; each carries a description.
//   owner-action: <what>  the owner does <what>, then runs `fuse-flow continue --owner-approved`
//   script: <command>     the shell command exits 0 when run from the repository root
//   agent: <what>         an agent does <what> (e.g. a review) before the step is continued
export const GATE_KINDS = ["owner-action", "script", "agent"] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export type Gate = { kind: GateKind; description: string };

// Accepts `{ script: "bun run check" }`, `script("bun run check")` or
// `script: bun run check`, plus the older `owner`, `none` and `check: <command>`.
function parseGate(v: unknown): Gate | null | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v);
    if (entries.length !== 1) return undefined;
    const [kind, description] = entries[0];
    return isKind(kind) && typeof description === "string" && description.trim()
      ? { kind, description: description.trim() }
      : undefined;
  }
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "none") return null;
  if (s === "owner") return { kind: "owner-action", description: "approve" };
  const m = /^([a-z-]+)\s*(?:\(\s*"?(.*?)"?\s*\)|:(.*))$/s.exec(s);
  if (!m) return undefined;
  const kind = m[1] === "check" ? "script" : m[1];
  const description = (m[2] ?? m[3] ?? "").trim();
  return isKind(kind) && description ? { kind, description } : undefined;
}

const isKind = (k: string): k is GateKind => (GATE_KINDS as readonly string[]).includes(k);

export function describeGate(gate: Gate): string {
  return `${gate.kind}(${gate.description})`;
}

export function describeGates(gates: Gate[]): string {
  return gates.length ? gates.map(describeGate).join(", ") : "none";
}

const GATE_HINT = 'must be owner-action("…"), script("…") or agent("…"), as a string or a one-key mapping';

const gateList = z
  .unknown()
  .transform((v, ctx) => {
    const items = v === undefined ? [] : Array.isArray(v) ? v : [v];
    const gates: Gate[] = [];
    for (const item of items) {
      const gate = parseGate(item);
      if (gate === undefined) ctx.addIssue({ code: "custom", message: `${GATE_HINT}, got ${JSON.stringify(item)}` });
      else if (gate) gates.push(gate);
    }
    return gates;
  });

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens");

// A single string or a list of strings (0..n), always read back as a list.
const oneOrMany = z
  .union([z.string().min(1), z.array(z.string().min(1))])
  .optional()
  .transform((v) => (v === undefined ? [] : typeof v === "string" ? [v] : v));

const StepSchema = z
  .object({
    id,
    title: z.string().optional(),
    // `skill` and `skills` both take one path or a list; they are merged.
    skill: oneOrMany,
    skills: oneOrMany,
    instruction: z.string().min(1).optional(),
    produces: oneOrMany,
    // `gate` and `gates` both take one gate or a list; they are merged.
    gate: gateList,
    gates: gateList,
    // Which earlier steps this one builds on, for the reader and for a
    // workflow's author. fuse-flow hands out steps in file order regardless.
    depends_on: z.array(id).optional(),
    // Overrides the workflow's max_fix_cycles for this step.
    max_fix_cycles: z.number().int().min(1).optional(),
  })
  .strict()
  .transform(({ skill, skills, gate, gates, ...rest }) => ({
    ...rest,
    skills: [...new Set([...skill, ...skills])],
    gates: [...gate, ...gates],
  }))
  .refine((step) => step.skills.length > 0 || step.instruction, "a step needs a skill, an instruction, or both");

const WorkflowSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    // How many refused `continue` attempts a step gets before it is blocked,
    // unless the step sets its own max_fix_cycles.
    max_fix_cycles: z.number().int().min(1).default(2),
    steps: z.array(StepSchema).min(1),
  })
  .strict()
  .superRefine((wf, ctx) => {
    // A step may only depend on steps listed before it, so the file order,
    // which is the order fuse-flow runs the steps in, respects every dependency.
    const earlier = new Set<string>();
    wf.steps.forEach((step, i) => {
      if (earlier.has(step.id)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: `duplicate step id "${step.id}"` });
      }
      for (const dep of step.depends_on ?? []) {
        if (!earlier.has(dep)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", i, "depends_on"],
            message: `"${step.id}" depends on "${dep}", which is not a step listed before it`,
          });
        }
      }
      earlier.add(step.id);
    });
  });

export type Workflow = z.infer<typeof WorkflowSchema>;
export type Step = Workflow["steps"][number];

export function loadWorkflow(path: string): Workflow {
  if (!existsSync(path)) throw new FlowError(`no workflow at ${path}`);
  let yaml: unknown;
  try {
    yaml = YAML.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new FlowError(`${path} is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = WorkflowSchema.safeParse(yaml);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(top level)"}: ${i.message}`);
    throw new FlowError(`${path} is not a valid workflow:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
