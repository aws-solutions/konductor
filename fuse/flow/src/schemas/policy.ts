// SPDX-License-Identifier: Apache-2.0
// The schema of a policy file, policy-overrides.yml: the values a project or a
// user sets instead of the defaults of the engine and the workflows. It holds
// only values the engine reads. `bun run schema` writes it to
// policy.schema.json.

import { z } from "zod";
import { CHECK_KIND } from "./gate.ts";
import { ARTIFACT_ID } from "./step.ts";

const LaunchSchema = z.union([
  z.literal("subagent"),
  z
    .object({
      command: z.string().trim().min(1).meta({
        description:
          "The shell command that runs one review, from the repository root. `{model}`, `{effort}`, " +
          "`{prompt_file}` and `{findings_file}` are replaced: the agent writes the review request to the prompt " +
          "file, and the reviewer writes its findings to the findings file.",
      }),
    })
    .strict(),
]);

const ReviewerSchema = z
  .object({
    model: z.string().min(1).meta({ description: "The model the reviewer runs on." }),
    effort: z.string().min(1).optional().meta({ description: "The reasoning effort, such as high." }),
    launch: LaunchSchema.optional().meta({
      description: "How to start this reviewer, when it differs from `review.launch`, for example a model the agent's harness cannot run.",
    }),
  })
  .strict();

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
        examples: [{ default: "bun run check" }, { default: "npm run build", test: "none" }],
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
          description: "Who reviews, in words, such as a model or a harness. Engine effect: printed with the gate.",
          examples: ["a different model from the one that did the work"],
        }),
        reviewers: z
          .record(z.string().min(1), ReviewerSchema)
          .optional()
          .meta({
            description:
              "The reviewer's model for each model an author may run on, by the author's model name. The layers " +
              "merge by author model, the more specific file winning. Engine effect: printed with the gate; the " +
              "agent picks the row for its own model.",
            examples: [
              {
                "claude-opus-5.5": { model: "gpt-6.1-sol", effort: "high" },
                "gpt-6.1-sol": { model: "claude-opus-5.5", effort: "high" },
              },
            ],
          }),
        launch: LaunchSchema.optional().meta({
          description:
            "How the agent starts a reviewer: `subagent`, a fresh subagent in the agent's own harness (the " +
            "default), or a command such as another harness on the terminal. A reviewer row's own launch wins. " +
            "Engine effect: printed with the gate.",
          examples: [
            "subagent",
            { command: "opencode run -m amazon-bedrock/us.openai.{model} --agent review-readonly \"$(cat {prompt_file})\"" },
          ],
        }),
      })
      .strict()
      .optional()
      .meta({ description: "How agent gates review." }),
    rulings: z
      .array(z.string().trim().min(1))
      .optional()
      .meta({
        description:
          "The owner's rulings where fuse-flow and another installed skill or always-on instruction overlap, " +
          "in plain sentences, such as which of two review mechanisms runs. Every layer's rulings apply, the more " +
          "specific file's last. Engine effect: printed with every step.",
        examples: [["In fuse-flow workstreams, the workflow's review gates replace the code-review skill's own review loop."]],
      }),
    artifacts: z
      .record(ARTIFACT_ID, z.object({ path: z.string().min(1) }).strict())
      .optional()
      .meta({
        description:
          "Where this project keeps an artifact, by artifact id, relative to the repository root; `{slug}` is " +
          "replaced with the workstream's slug and `{date}` with the local date the workstream started. Engine " +
          "effect: replaces the path the workflow gives.",
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
