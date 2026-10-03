// SPDX-License-Identifier: Apache-2.0
// The schema of a policy file, policy-overrides.yml: the values a project or a
// user sets instead of the defaults of the engine and the workflows
// (decisions 24, 37 and 44). It holds only values the engine reads. `bun run
// schema` writes it to policy.schema.json.

import { z } from "zod";
import { CHECK_KIND } from "./gate.ts";
import { ARTIFACT_ID } from "./step.ts";

export const PolicySchema = z
  .object({
    checks: z
      .record(
        z.string().regex(CHECK_KIND, "a kind of check is a single lower-case word, such as default"),
        z.string().trim().min(1),
      )
      .optional()
      .meta({
        description:
          "Each kind of check a workflow's `check:` gates name, bound to the command that runs it from the " +
          "repository root, or to `none` where the kind does not apply. Engine effect: a `check` gate runs the " +
          "bound command; a kind bound to none passes and is reported as not configured in this project.",
        examples: [{ default: "bun run check" }, { default: "brazil-build release", test: "none" }],
      }),
    review: z
      .object({
        max_rounds: z.number().int().min(1).optional().meta({
          description: "The round cap of every agent gate. Engine effect: printed as the cap.",
        }),
        guide: z.string().min(1).optional().meta({
          description:
            "A review guide for every agent gate, relative to this file or absolute. It replaces the guides of " +
            "the workflow's gates and the artifacts' review guides. Engine effect: printed with the gate.",
        }),
        reviewer: z.string().min(1).optional().meta({
          description: "Who reviews, such as a model or a harness. Engine effect: printed with the gate.",
          examples: ["a different model from the one that did the work"],
        }),
      })
      .strict()
      .optional()
      .meta({ description: "How agent gates review." }),
    artifacts: z
      .record(ARTIFACT_ID, z.object({ path: z.string().min(1) }).strict())
      .optional()
      .meta({
        description:
          "Where this project keeps an artifact, by artifact id, relative to the repository root; `{slug}` is " +
          "replaced with the workstream's slug. Engine effect: replaces the path the workflow gives.",
        examples: [{ spec: { path: "docs/specs/{slug}.md" } }],
      }),
  })
  .strict()
  .meta({
    id: "Policy",
    title: "fuse-flow policy overrides",
    description:
      "Values that replace the defaults of fuse-flow and of the workflows. The files, from the most general to " +
      "the most specific: ~/.konductor/policy-overrides.yml (the user's, below the workflow), " +
      ".konductor/policy-overrides.yml (the team's, in git) and .konductor/policy-overrides.local.yml (the " +
      "user's for this project, gitignored); each overrides the ones before it.",
  });

export type Policy = z.infer<typeof PolicySchema>;
