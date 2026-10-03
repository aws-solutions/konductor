// SPDX-License-Identifier: Apache-2.0
// Loading a workflow file, and describing its gates in fuse-flow output. The
// fields themselves are defined in schemas/.

import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { FlowError } from "./errors.ts";
import type { Gate } from "./schemas/gate.ts";
import { WorkflowSchema, type Workflow } from "./schemas/workflow.ts";

export type { Gate, GateKind } from "./schemas/gate.ts";
export type { Step } from "./schemas/step.ts";
export type { Workflow } from "./schemas/workflow.ts";

export function describeGate(gate: Gate): string {
  return `${gate.kind}(${gate.text})`;
}

export function describeGates(gates: Gate[]): string {
  return gates.length ? gates.map(describeGate).join(", ") : "none";
}

export function loadWorkflow(path: string): Workflow {
  if (!existsSync(path)) throw new FlowError(`no workflow at ${path}`);
  let yaml: unknown;
  try {
    yaml = YAML.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new FlowError(`${path} is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = WorkflowSchema.safeParse(yaml);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(top level)"}: ${i.message}`);
    throw new FlowError(`${path} is not a valid workflow:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
