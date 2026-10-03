// SPDX-License-Identifier: Apache-2.0
// The schema of a step: one unit of work in a workflow. `bun run schema`
// writes it to step.schema.json.

import { z } from "zod";
import { GateListSchema, STEP_ID } from "./gate.ts";

const GATE_DOC =
  "What must hold before the step counts as done, besides its artifacts existing: one gate or a list, " +
  "in any combination of kinds. `gate` and `gates` are the same field; both may be given, and their " +
  "lists are merged. Engine effect: see each gate kind.";

const id = STEP_ID;

// A single string or a list of strings (0..n), always read back as a list.
const oneOrMany = z
  .union([z.string().min(1), z.array(z.string().min(1))])
  .optional()
  .transform((v) => (v === undefined ? [] : typeof v === "string" ? [v] : v));

const SKILL_DOC =
  "Skill files to read before working on the step: one path or a list. A path is relative to a skills " +
  'directory (see "Skills" in fuse/flow/README.md for the search order) or absolute. ' +
  "`skill` and `skills` are the same field; both may be given, and their lists are merged. " +
  "Engine effect: printed as one `read:` line per file when the step becomes current; " +
  "a file that is not found prints a warning, and the step still runs.";

export const StepSchema = z
  .object({
    id: id.meta({
      description:
        "Identifier of the step, unique in the workflow: lowercase letters, digits and hyphens. " +
        "Engine effect: the state file records each step under its id, so renaming a step in a running " +
        "workstream starts that step over.",
      examples: ["requirements", "code-review"],
    }),
    description: z.string().optional().meta({
      description: "What the step is for, in free text, for the reader. Engine effect: none.",
    }),
    title: z.string().optional().meta({
      description: "Human-readable name of the step. Engine effect: none; printed next to the id and shown by the viewer.",
      examples: ["2. Requirements"],
    }),
    skill: oneOrMany.meta({ description: SKILL_DOC }),
    skills: oneOrMany.meta({ description: SKILL_DOC }),
    instruction: z.string().min(1).optional().meta({
      description:
        "What this step must achieve, in this workflow. Engine effect: printed as `instruction:` when the step " +
        "becomes current. A step needs a skill, an instruction, or both.",
    }),
    produces: oneOrMany.meta({
      description:
        "Artifacts the step must leave behind: one path or a list, relative to the repository root. " +
        "Engine effect: `continue` is refused while one of them is missing. The refusal names the path it expected.",
      examples: [".konductor/requirements/requirements.md"],
    }),
    gate: GateListSchema.meta({ description: GATE_DOC }),
    gates: GateListSchema.meta({ description: GATE_DOC }),
    depends_on: z.array(id).optional().meta({
      description:
        "Ids of earlier steps whose output this step builds on. " +
        "Engine effect: none on order; fuse-flow runs the steps in file order regardless. " +
        "An id that is not a step listed earlier is refused. The viewer draws its edges from this field.",
    }),
  })
  .strict()
  .meta({
    id: "Step",
    title: "fuse-flow step",
    description:
      "One unit of work. Besides the rules on each field, fuse-flow checks at run time that the step " +
      "has a skill, an instruction, or both, and that its id is not used by an earlier step.",
  })
  .transform(({ skill, skills, gate, gates, ...rest }) => ({
    ...rest,
    skills: [...new Set([...skill, ...skills])],
    gates: [...gate, ...gates],
  }))
  .refine((step) => step.skills.length > 0 || step.instruction, "a step needs a skill, an instruction, or both");

export type Step = z.infer<typeof StepSchema>;
