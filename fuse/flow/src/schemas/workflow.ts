// SPDX-License-Identifier: Apache-2.0
// The schema of a workflow file: the ordered steps a workstream goes through.
// The schemas in this folder are the source of truth: `bun run schema` turns
// each of them (workflow.ts, step.ts, gate.ts) into a JSON Schema file, which
// editors use to validate workflow files and show the descriptions on hover.
//
// Every description ends with the field's effect on the engine, so a reader
// can tell a field fuse-flow acts on from one that only documents the step.

import { z } from "zod";
import { StepSchema } from "./step.ts";

export const WorkflowSchema = z
  .object({
    version: z.literal(1).meta({
      description:
        "Version of the workflow file format; 1 is the only version so far. Engine effect: a file with any " +
        "other value is refused, so a file written for a different format is not misread.",
    }),
    name: z.string().min(1).meta({
      description: "Human-readable name of the workflow. Engine effect: none; shown by `fuse-flow status` and the viewer.",
    }),
    description: z.string().optional().meta({
      description: "What the workflow is for, in a sentence or two. Engine effect: none; shown by the viewer.",
    }),
    steps: z.array(StepSchema).min(1).meta({
      description:
        "The steps, in the order fuse-flow runs them. The current step is the first one in the list that is not " +
        "done, so steps run one at a time, in file order.",
    }),
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
      // A gate routes back to this step or one listed before it.
      for (const target of new Set(step.gates.flatMap((g) => g.route_back_to))) {
        if (!earlier.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", i, "gates"],
            message: `"${step.id}" routes back to "${target}", which is not this step or a step listed before it`,
          });
        }
      }
    });
  })
  // Last, because a refinement returns a new schema that does not carry metadata.
  .meta({
    id: "Workflow",
    title: "fuse-flow workflow",
    description:
      "A fuse-flow workflow: the ordered steps a workstream goes through, and what closes each one. " +
      "Start a workstream with `fuse-flow start <slug> --workflow <name>`.",
  });

export type Workflow = z.infer<typeof WorkflowSchema>;
