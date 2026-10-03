// SPDX-License-Identifier: Apache-2.0
// The schema of a step: one unit of work in a workflow. `bun run schema`
// writes it to step.schema.json.

import { z } from "zod";
import { ConditionSchema, GateListSchema, STEP_ID } from "./gate.ts";

export const ARTIFACT_ID = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens");

// One artifact a step produces or updates: an id, which names its folder in the
// library (library/artifacts/<id>/), and where it lives in the project.
export const ArtifactSchema = z
  .object({
    artifact: ARTIFACT_ID.meta({
      description:
        "The artifact's id. Engine effect: its guide, template and review guide are looked up in " +
        "library/artifacts/<id>/ (the project's .konductor/library/ first, then ~/.konductor/library/, then the " +
        "library that ships with fuse-flow), and the project's policy may move it to another path.",
      examples: ["spec", "design", "code"],
    }),
    path: z.string().min(1).meta({
      description:
        "Where the artifact lives, relative to the repository root: a file, or a directory for code. `{slug}` is " +
        "replaced with the workstream's slug, so two workstreams do not write the same file.",
      examples: ["docs/specs/{slug}.md", "src/"],
    }),
    description: z.string().optional().meta({ description: "Notes for the reader. Engine effect: none." }),
  })
  .strict()
  .meta({ id: "Artifact", title: "fuse-flow artifact", description: "An artifact a step produces or updates." });

export type Artifact = z.infer<typeof ArtifactSchema>;

const artifacts = (description: string) =>
  z
    .union([ArtifactSchema, z.array(ArtifactSchema)])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
    .meta({ description });

export const StepSchema = z
  .object({
    id: STEP_ID.meta({
      description:
        "Identifier of the step, unique in the workflow: lowercase letters, digits and hyphens. " +
        "Engine effect: the state file records each step under its id, so renaming a step in a running " +
        "workstream starts that step over.",
      examples: ["requirements", "code-review"],
    }),
    title: z.string().optional().meta({
      description: "Human-readable name of the step. Engine effect: none; shown by the viewer and in `status`.",
      examples: ["2. Requirements"],
    }),
    description: z.string().optional().meta({
      description: "Notes on the step for the reader. Engine effect: none.",
    }),
    phase: z.string().optional().meta({
      description: "A label that groups steps, such as Inception or Construction. Engine effect: none; shown by the viewer.",
    }),
    instruction: z.string().trim().min(1).meta({
      description:
        "What this step must achieve, in this workflow. Engine effect: it opens the step block that fuse-flow " +
        "prints when the step is handed out.",
    }),
    condition: ConditionSchema,
    consumes: z.array(ARTIFACT_ID).optional().transform((v) => v ?? []).meta({
      description:
        "Ids of artifacts produced or updated by earlier steps that this step reads. Engine effect: the step " +
        "block lists each with its path and whether it exists; an id no earlier step produces or updates is " +
        "refused.",
    }),
    produces: artifacts(
      "Artifacts the step writes: one or a list. Engine effect: `continue` is refused while one of them is " +
        'neither on disk nor reported with `--not-produced <artifact> "<reason>"`. A path that already exists ' +
        "and that this workstream did not record is reported when the step is handed out.",
    ),
    optional_produces: artifacts(
      "Artifacts the step may write. Engine effect: listed in the step block and recorded when they exist; " +
        "never refused.",
    ),
    updates: artifacts(
      "Artifacts the step changes, which usually exist when it starts, such as code. Engine effect: `continue` " +
        'is refused until each is accounted for, with `--updated <file>` or `--unchanged <artifact> "<reason>"`.',
    ),
    gates: GateListSchema.meta({
      description:
        "What must hold before the step counts as done: one gate or a list, in any combination of kinds. " +
        "Engine effect: they run in a fixed order, checks first, then the agent review, then the owner.",
    }),
  })
  .strict()
  .meta({
    id: "Step",
    title: "fuse-flow step",
    description:
      "One unit of work. Besides the rules on each field, fuse-flow checks that its id is not used by an " +
      "earlier step and that what it consumes and routes back to comes before it.",
  });

export type Step = z.infer<typeof StepSchema>;
