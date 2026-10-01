// SPDX-License-Identifier: Apache-2.0
// A workflow definition: which steps exist, in which order they run, and what
// closes each one. fuse-flow only reads it.

import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { FlowError } from "./errors.ts";

// What must hold before a step counts as done, besides its artifacts existing.
//   none              nothing else
//   owner             the owner approves it with `fuse-flow continue --owner-approved`
//   check: <command>  the shell command exits 0 when run from the repository root
export type Gate = { kind: "none" } | { kind: "owner" } | { kind: "check"; command: string };

function parseGate(text: string): Gate | undefined {
  const s = text.trim();
  if (s === "none") return { kind: "none" };
  if (s === "owner") return { kind: "owner" };
  const command = /^check:(.*)$/s.exec(s)?.[1].trim();
  return command ? { kind: "check", command } : undefined;
}

export function describeGate(gate: Gate): string {
  return gate.kind === "check" ? `check: ${gate.command}` : gate.kind;
}

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens");

const StepSchema = z
  .object({
    id,
    title: z.string().optional(),
    skill: z.string().min(1).optional(),
    instruction: z.string().min(1).optional(),
    produces: z.array(z.string().min(1)).default([]),
    gate: z
      .string()
      .default("none")
      .transform((text, ctx) => {
        const gate = parseGate(text);
        if (!gate) {
          ctx.addIssue({ code: "custom", message: `must be none, owner or "check: <command>", got "${text}"` });
        }
        return gate ?? z.NEVER;
      }),
    // Which earlier steps this one builds on, for the reader and for a
    // workflow's author. fuse-flow hands out steps in file order regardless.
    depends_on: z.array(id).optional(),
    // Overrides the workflow's max_fix_cycles for this step.
    max_fix_cycles: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((step) => step.skill || step.instruction, "a step needs a skill, an instruction, or both");

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
