// SPDX-License-Identifier: Apache-2.0
// Reads every *.yml under ../../workflows (subfolders included) at build time
// and turns each into the shape the diagram draws. Read-only: nothing is written back.

import { parseWorkflow, type Workflow } from "./workflowParser.ts";

export { parseWorkflow };
export type { Artifact, ArtifactRole, Gate, GateKind, Step, Workflow } from "./workflowParser.ts";

const WORKFLOWS_DIR = "fuse/flow/workflows";

const sources = import.meta.glob("../../workflows/**/*.yml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const workflowsDir = WORKFLOWS_DIR;

export const workflows: Workflow[] = Object.entries(sources)
  .map(([key, text]) => parseWorkflow(key.replace("../../workflows/", ""), text))
  .sort((a, b) => a.dir.localeCompare(b.dir) || a.file.localeCompare(b.file));
