// SPDX-License-Identifier: Apache-2.0
// Parsing a workflow from its text, with no file access, so the same code
// runs in fuse-flow and in the browser (Komposer). It imports only `yaml` and
// the schemas.

import YAML from "yaml";
import type { Gate } from "./schemas/gate.ts";
import { WorkflowSchema, type Workflow } from "./schemas/workflow.ts";

export interface WorkflowIssue {
  // Where the problem is, as keys and list indices into the YAML: for
  // example ["steps", 2, "gates", 1, "route_back_to"]. Empty for the file as a
  // whole.
  path: (string | number)[];
  // "yaml" when the text is not valid YAML; otherwise the schema's issue code.
  code: string;
  message: string;
}

export type ParsedWorkflow = { ok: true; workflow: Workflow } | { ok: false; issues: WorkflowIssue[] };

export function parseWorkflowText(text: string): ParsedWorkflow {
  let yaml: unknown;
  try {
    yaml = YAML.parse(text);
  } catch (e) {
    return { ok: false, issues: [{ path: [], code: "yaml", message: `not valid YAML: ${(e as Error).message}` }] };
  }
  const parsed = WorkflowSchema.safeParse(yaml);
  if (parsed.success) return { ok: true, workflow: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.filter((k): k is string | number => typeof k !== "symbol"),
      code: i.code,
      message: i.message,
    })),
  };
}

// An issue as one line of `fuse-flow validate` output.
export function formatIssue(issue: WorkflowIssue): string {
  return `${issue.path.join(".") || "(top level)"}: ${issue.message}`;
}

export function describeGate(gate: Gate): string {
  return `${gate.kind}(${gate.text})`;
}

export function describeGates(gates: Gate[]): string {
  return gates.length ? gates.map(describeGate).join(", ") : "none";
}
