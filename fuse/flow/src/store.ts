// SPDX-License-Identifier: Apache-2.0
// Reading and writing the two YAML files, always through the schemas.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatIssues, WorkflowSchema, WorkstreamSchema, type Workflow, type Workstream } from "./schema";

export class FlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowError";
  }
}

function parseYaml(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new FlowError(`cannot read ${path}`);
  }
  try {
    return Bun.YAML.parse(text);
  } catch (e) {
    throw new FlowError(`${path} is not valid YAML: ${(e as Error).message}`);
  }
}

export function readWorkflow(path: string): Workflow {
  if (!existsSync(path)) throw new FlowError(`no workflow at ${path}`);
  const parsed = WorkflowSchema.safeParse(parseYaml(path));
  if (!parsed.success) throw new FlowError(formatIssues(`${path} is not a valid workflow:`, parsed.error));
  return parsed.data;
}

export function readWorkstream(path: string): Workstream {
  if (!existsSync(path)) throw new FlowError(`no workstream at ${path}; run fuse-flow start first`);
  const parsed = WorkstreamSchema.safeParse(parseYaml(path));
  if (!parsed.success) throw new FlowError(formatIssues(`${path} is not a valid workstream:`, parsed.error));
  return parsed.data;
}

// Write through a temp file and rename so a crash never leaves a half
// written state file behind.
export function writeWorkstream(path: string, ws: Workstream): void {
  const checked = WorkstreamSchema.parse(ws);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, Bun.YAML.stringify(toPlain(checked), null, 2) + "\n");
  renameSync(tmp, path);
}

// Bun.YAML.stringify emits every key it is given; undefined optional fields
// would surface as nulls that fail the strict schema on the next read.
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
