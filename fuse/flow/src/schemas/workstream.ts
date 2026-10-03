// SPDX-License-Identifier: Apache-2.0
// The schema of a workstream's state file, .konductor/workstreams/<slug>.yml:
// where each step of the workflow stands. Only fuse-flow writes this file, and
// git ignores it. State files written before the six step states are read and
// migrated (decision 40).

import { z } from "zod";

export const STEP_STATES = ["PENDING", "IN_PROGRESS", "AWAITING_OWNER", "BLOCKED", "COMPLETED", "SKIPPED"] as const;
export type StepStatus = (typeof STEP_STATES)[number];

const LEGACY_STATES: Record<string, StepStatus> = {
  pending: "PENDING",
  "awaiting-owner": "AWAITING_OWNER",
  blocked: "BLOCKED",
  done: "COMPLETED",
};

// An artifact the workstream recorded, with its status (decision 34).
export const RecordedArtifactSchema = z
  .object({
    artifact: z.string().optional().meta({ description: "The artifact's id; absent in migrated state files." }),
    path: z.string(),
    status: z.enum(["draft", "approved", "superseded"]),
  })
  .strict();

export const StepStateSchema = z
  .preprocess(
    (raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const { fix_cycles: _dropped, ...state } = raw as Record<string, unknown>;
      if (typeof state.status === "string" && state.status in LEGACY_STATES) {
        const done = state.status === "done";
        state.status = LEGACY_STATES[state.status];
        if (Array.isArray(state.artifacts)) {
          state.artifacts = state.artifacts.map((a) =>
            typeof a === "string" ? { path: a, status: done ? "approved" : "draft" } : a,
          );
        }
      }
      return state;
    },
    z
      .object({
        status: z.enum(STEP_STATES).meta({
          description:
            "PENDING: not handed out yet. IN_PROGRESS: handed out; the agent is working on it. AWAITING_OWNER: " +
            "the work is done and an owner-action gate waits. BLOCKED: the agent reported that the planned path " +
            "broke down. COMPLETED and SKIPPED: finished.",
        }),
        skip_reason: z.string().optional(),
        rounds_granted: z.number().int().min(1).optional().meta({
          description: "Review rounds the owner granted on top of the agent gates' cap, with --more-rounds.",
        }),
        artifacts: z.array(RecordedArtifactSchema).meta({ description: "The artifacts recorded for the step." }),
        updated: z.array(z.string()).optional().meta({ description: "The files the agent reported with --updated." }),
        unchanged: z.record(z.string(), z.string()).optional().meta({
          description: "Updates artifacts the agent left as they were, with the reason, by artifact id.",
        }),
        not_produced: z.record(z.string(), z.string()).optional().meta({
          description: "Produces artifacts the agent did not write, with the reason, by artifact id.",
        }),
        existed: z.array(z.string()).optional().meta({
          description: "Produces paths that existed, unrecorded by this workstream, when the step was handed out.",
        }),
        verification: z.array(z.string()).optional().meta({
          description: "The result of each check and script gate when the step was last continued.",
        }),
        history: z.array(z.string()).meta({ description: "One timestamped line per event on the step, oldest first." }),
      })
      .strict(),
  )
  .meta({ description: "Where one step stands. A step the file does not mention yet is PENDING." });

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

export type RecordedArtifact = z.infer<typeof RecordedArtifactSchema>;
export type StepState = z.infer<typeof StepStateSchema>;
export type Workstream = z.infer<typeof WorkstreamSchema>;
