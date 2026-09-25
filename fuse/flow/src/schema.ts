// SPDX-License-Identifier: Apache-2.0
// Zod schemas for the two files fuse-flow owns: the workflow definition
// (.konductor/workflow.yml) and one state file per workstream
// (.konductor/workstreams/<slug>.yml).

import { z } from "zod";

const stepId = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "step ids are lowercase letters, digits and hyphens");

// gate: none | owner | check:<cmd>
export type Gate =
  | { kind: "none" }
  | { kind: "owner" }
  | { kind: "check"; command: string };

export function parseGate(raw: string): Gate {
  const s = raw.trim();
  if (s === "none") return { kind: "none" };
  if (s === "owner") return { kind: "owner" };
  const m = /^check:\s*(.+)$/s.exec(s);
  if (m && m[1].trim().length > 0) return { kind: "check", command: m[1].trim() };
  throw new Error(`gate must be "none", "owner" or "check:<command>", got "${raw}"`);
}

export function formatGate(g: Gate): string {
  return g.kind === "check" ? `check: ${g.command}` : g.kind;
}

const gateField = z
  .string()
  .default("none")
  .transform((s, ctx) => {
    try {
      return parseGate(s);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

export const WorkflowStepSchema = z
  .object({
    id: stepId,
    title: z.string().optional(),
    skill: z.string().min(1).optional(),
    instruction: z.string().min(1).optional(),
    produces: z.array(z.string().min(1)).default([]),
    gate: gateField,
    depends_on: z.array(stepId).optional(),
  })
  .strict()
  .refine((s) => s.skill !== undefined || s.instruction !== undefined, {
    message: "a step needs a skill path, an inline instruction, or both",
  });

export const WorkflowSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    max_fix_cycles: z.number().int().min(1).default(2),
    steps: z.array(WorkflowStepSchema).min(1),
  })
  .strict()
  .superRefine((wf, ctx) => {
    const ids = new Set<string>();
    wf.steps.forEach((s, i) => {
      if (ids.has(s.id)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: `duplicate step id "${s.id}"` });
      }
      ids.add(s.id);
    });
    wf.steps.forEach((s, i) => {
      for (const dep of s.depends_on ?? []) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", i, "depends_on"],
            message: `step "${s.id}" depends on unknown step "${dep}"`,
          });
        }
        if (dep === s.id) {
          ctx.addIssue({ code: "custom", path: ["steps", i, "depends_on"], message: `step "${s.id}" depends on itself` });
        }
      }
    });
  });

export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowStep = Workflow["steps"][number];

// Resolved dependencies: a step without depends_on depends on the step
// before it, so a plain list is a linear workflow. An explicit empty list
// makes a step independent.
export function dependenciesOf(wf: Workflow, step: WorkflowStep): string[] {
  if (step.depends_on !== undefined) return step.depends_on;
  const i = wf.steps.findIndex((s) => s.id === step.id);
  return i > 0 ? [wf.steps[i - 1].id] : [];
}

export const StepStatusSchema = z.enum(["pending", "awaiting-owner", "blocked", "done"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const GateOutcomeSchema = z
  .object({
    outcome: z.enum(["none", "check-passed", "owner-approved"]),
    at: z.string(),
    note: z.string().optional(),
  })
  .strict();

export const StepStateSchema = z
  .object({
    status: StepStatusSchema.default("pending"),
    artifacts: z.array(z.string()).default([]),
    fix_cycles: z.number().int().min(0).default(0),
    gate: GateOutcomeSchema.optional(),
    notes: z.array(z.string()).default([]),
    updated: z.string().optional(),
  })
  .strict();

export const WorkstreamSchema = z
  .object({
    version: z.literal(1),
    slug: z.string().min(1),
    project: z
      .object({
        root: z.string().min(1),
        identity: z.string().min(1),
      })
      .strict(),
    workflow: z.string().min(1),
    created: z.string(),
    updated: z.string(),
    steps: z.record(z.string(), StepStateSchema),
  })
  .strict();

export type Workstream = z.infer<typeof WorkstreamSchema>;
export type StepState = Workstream["steps"][string];

export function formatIssues(prefix: string, err: z.ZodError): string {
  const lines = err.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  return `${prefix}\n${lines.join("\n")}`;
}
