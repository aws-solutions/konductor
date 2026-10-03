// SPDX-License-Identifier: Apache-2.0
// The mechanical half of a smoke verdict. After a smoke run, it reads the
// project's one workstream and confirms that every step finished, every
// artifact is accounted for, and every mechanical gate still passes.
//
// usage: bun check.ts --project <dir> --workflow <workflow file>
// Exit codes: 0 PASS, 1 FAIL, 64 usage error.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { artifactPath, checkBinding, loadProject } from "../flow/src/policy.ts";
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

function contains(path: string, file: string): boolean {
  if (file.startsWith("/") || file === ".." || file.startsWith("../")) return false;
  const base = path.replace(/\/+$/, "").replace(/^\.\/+/, "");
  if (base === "" || base === ".") return true;
  return file === base || file.startsWith(`${base}/`);
}

function runGate(stepId: string, label: string, command: string): void {
  const result = Bun.spawnSync(["sh", "-c", command], {
    cwd: project,
    env: { ...(process.env as Record<string, string>), FUSE_FLOW_SLUG: slug, FUSE_FLOW_STEP: stepId },
    stdout: "ignore",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) failures.push(`${stepId}: ${label} failed: ${command}`);
}

const dir = workstreamsDir(project);
const slugs = existsSync(dir)
  ? readdirSync(dir)
      .filter((file) => file.endsWith(".yml"))
      .map((file) => basename(file, ".yml"))
  : [];
if (slugs.length !== 1) {
  failures.push(slugs.length === 0 ? `no workstream in ${dir}` : `expected one workstream, found ${slugs.join(", ")}`);
  finish();
}

const slug = slugs[0];
const workstream = readWorkstream(project, slug);
const followed = resolve(project, findWorkflow(project, workstream.workflow));
notes.push(`workstream ${slug} follows ${followed}`);
// A fixture may be copied into the project, but the copy must remain byte for
// byte identical to the harness's workflow under test.
if (followed !== workflowPath && readFileSync(followed, "utf8") !== readFileSync(workflowPath, "utf8")) {
  failures.push(`workstream ${slug} follows ${followed}, which differs from the workflow under test ${workflowPath}`);
  finish();
}

const workflow = loadWorkflow(workflowPath);
const policy = loadProject(project);
for (const step of workflow.steps) {
  const state = stateOf(workstream, step.id);
  const finishedStep = state.status === "COMPLETED" || (state.status === "SKIPPED" && Boolean(state.skip_reason));
  if (!finishedStep) {
    const detail = state.status === "SKIPPED" ? "SKIPPED without a reason" : state.status;
    failures.push(`${step.id}: not finished (${detail})`);
  }
  if (state.status === "SKIPPED" && state.skip_reason) {
    notes.push(`${step.id}: skipped: ${state.skip_reason}`);
    continue;
  }
  if (state.rounds_granted) notes.push(`${step.id}: owner granted ${state.rounds_granted} more review round(s)`);
  for (const line of state.history) {
    const approval = /owner approved.*$/.exec(line)?.[0];
    if (approval) notes.push(`${step.id}: ${approval}`);
  }

  for (const artifact of step.produces) {
    const path = artifactPath(policy, artifact, slug);
    if (!(artifact.artifact in (state.not_produced ?? {})) && !existsSync(resolve(project, path))) {
      failures.push(`${step.id}: missing artifact ${path} (${artifact.artifact})`);
    }
  }
  for (const artifact of step.updates) {
    const path = artifactPath(policy, artifact, slug);
    const updated = (state.updated ?? []).some((file) => contains(path, file));
    if (!updated && !(artifact.artifact in (state.unchanged ?? {}))) {
      failures.push(`${step.id}: update not accounted for ${path} (${artifact.artifact})`);
    }
  }

  for (const gate of step.gates) {
    if (gate.kind === "script") {
      runGate(step.id, "script", gate.text);
      continue;
    }
    if (gate.kind !== "check") continue;
    const binding = checkBinding(policy, gate.text);
    if (!binding) failures.push(`${step.id}: check ${gate.text} is unbound`);
    else if (binding.command === "none") notes.push(`${step.id}: check ${gate.text} is not configured in this project`);
    else runGate(step.id, `check ${gate.text}`, binding.command);
  }
}
finish();
