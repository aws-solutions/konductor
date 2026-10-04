// SPDX-License-Identifier: Apache-2.0
// Loading a workflow file. Parsing its text is in parse.ts, which Komposer
// shares; the fields themselves are defined in schemas/.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { FlowError } from "./errors.ts";
import { formatIssue, parseWorkflowText } from "./parse.ts";
import type { Workflow } from "./schemas/workflow.ts";

export { describeGate, describeGates } from "./parse.ts";
export type { Condition, Gate, GateKind } from "./schemas/gate.ts";
export type { Artifact, Step } from "./schemas/step.ts";
export type { Workflow } from "./schemas/workflow.ts";

export function loadWorkflow(path: string): Workflow {
  if (!existsSync(path)) throw new FlowError(`no workflow at ${path}`);
  const parsed = parseWorkflowText(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    if (parsed.issues[0]?.code === "yaml") throw new FlowError(`${path} is ${parsed.issues[0].message}`);
    const issues = parsed.issues.map((i) => `  ${formatIssue(i)}`);
    throw new FlowError(`${path} is not a valid workflow:\n${issues.join("\n")}`);
  }
  // A gate's review guide is relative to the workflow file, so a workflow and
  // its guides can be moved together.
  for (const step of parsed.workflow.steps) {
    for (const gate of step.gates) {
      if (gate.guide && !isAbsolute(gate.guide)) gate.guide = resolve(dirname(path), gate.guide);
    }
  }
  return parsed.workflow;
}
