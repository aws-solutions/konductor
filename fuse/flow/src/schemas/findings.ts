// SPDX-License-Identifier: Apache-2.0
// The schema of a review findings file,
// .konductor/reviews/<slug>/<step>-round-<n>.json: what one reviewer found in
// one round of an agent gate. The reviewer writes it, however it was started,
// and the agent that did the work reads it. fuse-flow only names the path.
// `bun run schema` writes it to review-findings.schema.json.

import { z } from "zod";

const FindingSchema = z
  .object({
    priority: z.enum(["P0", "P1", "P2", "P3"]).meta({
      description: "P0: wrong or unsafe. P1: a requirement missed, or a defect a user would hit. P2: worth fixing. P3: a nit.",
    }),
    title: z.string().min(1).meta({ description: "What is wrong, in one sentence that stands on its own." }),
    file: z.string().min(1).nullable().meta({ description: "The file it is in, relative to the repository root, or null." }),
    evidence: z.string().min(1).meta({ description: "What the reviewer saw, quoted or described, so the author can check it." }),
    impact: z.string().min(1).meta({ description: "Who or what it hurts, and how." }),
    scope: z.enum(["single", "pattern"]).meta({
      description: "Whether it is a single instance or a broken pattern with other occurrences.",
    }),
  })
  .strict();

const EarlierSchema = z
  .object({
    title: z.string().min(1).meta({ description: "The earlier finding, as the author reported it." }),
    status: z.enum(["fixed", "still-open", "regressed", "accepted"]).meta({
      description: "How the earlier finding stands now; accepted means the author's reason for not fixing it holds.",
    }),
    evidence: z.string().min(1),
  })
  .strict();

export const ReviewFindingsSchema = z
  .object({
    round: z.number().int().min(1).meta({ description: "The round of the gate this review is for, from 1." }),
    reviewer: z.string().min(1).meta({ description: "The model and harness that reviewed, such as gpt-6.1-sol in OpenCode." }),
    summary: z.string().min(1).meta({ description: "The reviewer's verdict, in a few sentences." }),
    findings: z.array(FindingSchema).meta({ description: "Every finding of this round, most severe first." }),
    earlier: z
      .array(EarlierSchema)
      .optional()
      .meta({ description: "From the second round on: how each finding of earlier rounds was handled." }),
  })
  .strict()
  .meta({
    id: "ReviewFindings",
    title: "fuse-flow review findings",
    description: "What one reviewer found in one round of an agent gate. The reviewer writes it; the author reads it.",
  });

export type ReviewFindings = z.infer<typeof ReviewFindingsSchema>;
