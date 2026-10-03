// SPDX-License-Identifier: Apache-2.0
// The schema of a workstream's state file, .konductor/workstreams/<slug>.yml:
// where each step of the workflow stands. Only fuse-flow writes this file, and
// git ignores it.

import { z } from "zod";

export const StepStateSchema = z
  .object({
    status: z.enum(["pending", "awaiting-owner", "blocked", "done"]).meta({
      description:
        "pending: the agent is working on the step; `continue` records it finished. " +
        "awaiting-owner: artifacts recorded, waiting for `continue --owner-approved`. " +
        "blocked: the agent reported it cannot finish the step (for example after max_rounds review rounds), " +
        "waiting for `continue --owner-approved`. " +
        "done: finished.",
    }),
    rounds_granted: z.number().int().min(1).optional().meta({
      description: "Review rounds the owner granted on top of the agent gates' max_rounds, with --more-rounds.",
    }),
    // Written by fuse-flow before it stopped counting refusals; read and dropped.
    fix_cycles: z.number().int().min(0).optional(),
    artifacts: z.array(z.string()).meta({ description: "The artifacts recorded when the step was continued." }),
    history: z.array(z.string()).meta({ description: "One timestamped line per event on the step, oldest first." }),
  })
  .strict()
  .meta({ description: "Where one step stands. A step the file does not mention yet is pending." })
  .transform(({ fix_cycles: _dropped, ...state }) => state);

// Step id -> state. An object with a catchall rather than z.record, which
// refuses objects that have a "constructor" key, and "constructor" is a valid
// step id.
export const WorkstreamSchema = z
  .object({
    workflow: z.string().min(1).meta({
      description: "The workflow the workstream follows, as given to `start`: a name, or an absolute path.",
    }),
    steps: z.object({}).catchall(StepStateSchema).meta({ description: "The state of each step, by step id." }),
  })
  .strict()
  .meta({ title: "fuse-flow workstream state" });

export type StepState = z.infer<typeof StepStateSchema>;
export type Workstream = z.infer<typeof WorkstreamSchema>;
