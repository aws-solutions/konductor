// SPDX-License-Identifier: Apache-2.0
// The mechanical half of a smoke verdict. After a smoke run, it reads the
// project's one workstream and confirms the workflow under test ran to the
// end: every step done, every declared and recorded artifact present, and
// every check gate still passing. It also lists the owner approvals, so they
// can be matched against the conversation.
//
// usage: bun check.ts --project <dir> --workflow <workflow file>
// Exit codes: 0 PASS, 1 FAIL, 64 usage error.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { findWorkflow, workstreamsDir } from "../flow/src/project.ts";
import { loadWorkflow } from "../flow/src/workflow.ts";
import { readWorkstream, stateOf } from "../flow/src/workstream.ts";

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error("usage: bun check.ts --project <dir> --workflow <workflow file>");
    process.exit(64);
  }
  return value;
}

const project = resolve(arg("--project"));
const workflowPath = resolve(arg("--workflow"));
const failures: string[] = [];
const notes: string[] = [];

function finish(): never {
  for (const line of notes) console.log(line);
  for (const line of failures) console.log(`FAIL ${line}`);
  console.log(failures.length === 0 ? "MECHANICAL: PASS" : "MECHANICAL: FAIL");
  process.exit(failures.length === 0 ? 0 : 1);
}

const dir = workstreamsDir(project);
const slugs = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => basename(f, ".yml"))
  : [];
if (slugs.length !== 1) {
  failures.push(
    slugs.length === 0 ? `no workstream in ${dir}` : `expected one workstream, found ${slugs.join(", ")}`,
  );
  finish();
}

const slug = slugs[0];
const ws = readWorkstream(project, slug);
const followed = resolve(project, findWorkflow(project, ws.workflow));
notes.push(`workstream ${slug} follows ${followed}`);
// The workstream may follow a copy (a fixture copied into the project), but
// only a byte-for-byte copy: an edited workflow is not the one under test.
if (followed !== workflowPath && readFileSync(followed, "utf8") !== readFileSync(workflowPath, "utf8")) {
  failures.push(`workstream ${slug} follows ${followed}, which differs from the workflow under test ${workflowPath}`);
  finish();
}

const workflow = loadWorkflow(workflowPath);
for (const step of workflow.steps) {
  const state = stateOf(ws, step.id);
  if (state.status !== "done") failures.push(`${step.id}: not done (${state.status})`);
  if (state.rounds_granted) notes.push(`${step.id}: owner granted ${state.rounds_granted} more review round(s)`);
  for (const line of state.history) {
    const approval = /owner approved.*$/.exec(line)?.[0];
    if (approval) notes.push(`${step.id}: ${approval}`);
  }
  for (const artifact of new Set([...step.produces, ...state.artifacts])) {
    if (!existsSync(join(project, artifact))) failures.push(`${step.id}: missing artifact ${artifact}`);
  }
  for (const gate of step.gates) {
    if (gate.kind !== "script") continue;
    const r = Bun.spawnSync(["sh", "-c", gate.text], { cwd: project, stdout: "ignore", stderr: "ignore" });
    if (r.exitCode !== 0) failures.push(`${step.id}: check failed: ${gate.text}`);
  }
}
finish();
