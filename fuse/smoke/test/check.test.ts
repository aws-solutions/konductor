// SPDX-License-Identifier: Apache-2.0
// End-to-end tests for the mechanical smoke verdict. Each test builds a
// throwaway project, drives the real fuse-flow command line, then runs check.ts.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SMOKE_DIR = resolve(import.meta.dir, "..");
const FLOW_CLI = resolve(SMOKE_DIR, "..", "flow", "src", "cli.ts");
const CHECK = join(SMOKE_DIR, "check.ts");

const WORKFLOW = `version: 1
name: tiny
steps:
  - id: prepare
    instruction: write the requirements
    produces:
      - artifact: requirements
        path: notes/{slug}.md
    gates:
      - owner-action: approve the requirements
  - id: research
    instruction: research only when needed
    condition:
      agent: the work needs research
    produces:
      - artifact: research-note
        path: research/{slug}.md
  - id: explain
    instruction: write a report when useful
    produces:
      - artifact: report
        path: reports/{slug}.md
  - id: update
    instruction: update the code
    updates:
      - artifact: code
        path: src/
  - id: verify
    instruction: verify the result
    gates:
      - check: default
      - script: test -f script-ok
`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): { root: string; workflow: string; env: Record<string, string> } {
  const base = process.env.KIROCREW_SCRATCH ?? tmpdir();
  const root = realpathSync(mkdtempSync(join(base, "fuse-smoke-check-")));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  const workflow = join(root, "tiny.yml");
  writeFileSync(workflow, WORKFLOW);
  writePolicy(root, "test -f check-ok");
  const env = { ...(process.env as Record<string, string>), HOME: join(root, "home") };
  return { root, workflow, env };
}

function writePolicy(root: string, command: string, artifactOverride = true): void {
  const artifact = artifactOverride ? "artifacts:\n  requirements:\n    path: records/{slug}/requirements.md\n" : "";
  write(root, ".konductor/policy-overrides.yml", `checks:\n  default: ${JSON.stringify(command)}\n${artifact}`);
}

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function flow(root: string, env: Record<string, string>, ...args: string[]): void {
  const result = Bun.spawnSync(["bun", FLOW_CLI, ...args], { cwd: root, env });
  if (result.exitCode !== 0) throw new Error(`fuse-flow ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
}

function check(root: string, workflow: string, env: Record<string, string>): { code: number; out: string } {
  const result = Bun.spawnSync(["bun", CHECK, "--project", root, "--workflow", workflow], { cwd: root, env });
  return { code: result.exitCode ?? -1, out: `${result.stdout}${result.stderr}` };
}

function runToEnd(root: string, workflow: string, env: Record<string, string>): void {
  flow(root, env, "start", "hello", "--workflow", workflow);
  write(root, "records/hello/requirements.md");
  flow(root, env, "continue", "hello");
  flow(root, env, "continue", "hello", "--owner-approved", "--note", "looks fine");
  flow(root, env, "continue", "hello", "--skip", "the change is already understood");
  flow(root, env, "continue", "hello", "--not-produced", "report", "the code is self-explanatory");
  write(root, "src/a.ts");
  flow(root, env, "continue", "hello", "--updated", "src/a.ts");
  write(root, "check-ok");
  write(root, "script-ok");
  flow(root, env, "continue", "hello");
}

function stateFile(root: string): string {
  return join(root, ".konductor", "workstreams", "hello.yml");
}

function projectCopy(root: string, text: string): void {
  write(root, ".konductor/workflows/tiny.yml", text);
}

test("completed and reasoned skipped steps pass with approvals and skip notes", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  const result = check(root, workflow, env);
  expect(result.out).toContain("prepare: owner approved: looks fine");
  expect(result.out).toContain("research: skipped: the change is already understood");
  expect(result.out).toContain("MECHANICAL: PASS");
  expect(result.code).toBe(0);
});

test("a workstream that stopped part way names unfinished states", () => {
  const { root, workflow, env } = project();
  flow(root, env, "start", "hello", "--workflow", workflow);
  const result = check(root, workflow, env);
  expect(result.out).toContain("prepare: not finished (IN_PROGRESS)");
  expect(result.out).toContain("research: not finished (PENDING)");
  expect(result.out).toContain("MECHANICAL: FAIL");
  expect(result.code).toBe(1);
});

test("a missing produces artifact fails at its policy-overridden slug path", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  rmSync(join(root, "records", "hello", "requirements.md"));
  const result = check(root, workflow, env);
  expect(result.out).toContain("prepare: missing artifact records/hello/requirements.md (requirements)");
  expect(result.code).toBe(1);
});

test("a produces artifact recorded as not produced needs no file", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  expect(readFileSync(stateFile(root), "utf8")).toContain("the code is self-explanatory");
  expect(check(root, workflow, env)).toMatchObject({ code: 0 });
});

test("an updates artifact without an updated file or unchanged reason fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  const state = readFileSync(stateFile(root), "utf8");
  writeFileSync(stateFile(root), state.replace(/\n    updated:\n      - src\/a\.ts/, ""));
  const result = check(root, workflow, env);
  expect(result.out).toContain("update: update not accounted for src/ (code)");
  expect(result.code).toBe(1);
});

test("a check gate is rerun through policy and fails when its binding fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  writePolicy(root, "false");
  const result = check(root, workflow, env);
  expect(result.out).toContain("verify: check default failed: false");
  expect(result.code).toBe(1);
});

test("an updates artifact with an unchanged reason passes", () => {
  const { root, workflow, env } = project();
  flow(root, env, "start", "hello", "--workflow", workflow);
  write(root, "records/hello/requirements.md");
  flow(root, env, "continue", "hello");
  flow(root, env, "continue", "hello", "--owner-approved", "--note", "looks fine");
  flow(root, env, "continue", "hello", "--skip", "the change is already understood");
  flow(root, env, "continue", "hello", "--not-produced", "report", "the code is self-explanatory");
  flow(root, env, "continue", "hello", "--unchanged", "code", "no code change was needed");
  write(root, "check-ok");
  write(root, "script-ok");
  flow(root, env, "continue", "hello");
  const result = check(root, workflow, env);
  expect(result.out).toContain("MECHANICAL: PASS");
  expect(result.code).toBe(0);
});

test("a check kind bound to none passes", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  writePolicy(root, "none");
  const result = check(root, workflow, env);
  expect(result.out).toContain("verify: check default is not configured in this project");
  expect(result.out).toContain("MECHANICAL: PASS");
  expect(result.code).toBe(0);
});

test("an unbound check kind fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  rmSync(join(root, ".konductor", "policy-overrides.yml"));
  const result = check(root, workflow, env);
  expect(result.out).toContain("verify: check default is unbound");
  expect(result.code).toBe(1);
});

test("a project with no workstream fails", () => {
  const { root, workflow, env } = project();
  const result = check(root, workflow, env);
  expect(result.out).toContain("no workstream");
  expect(result.code).toBe(1);
});

test("a workstream that follows a different workflow fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  const other = join(root, "other.yml");
  writeFileSync(other, WORKFLOW.replace("name: tiny", "name: other"));
  const result = check(root, other, env);
  expect(result.out).toContain("differs from the workflow under test");
  expect(result.code).toBe(1);
});

test("an unchanged project copy of the workflow passes", () => {
  const { root, workflow, env } = project();
  projectCopy(root, WORKFLOW);
  runToEnd(root, "tiny", env);
  expect(check(root, workflow, env)).toMatchObject({ code: 0 });
});

test("an edited project copy of the workflow fails", () => {
  const { root, workflow, env } = project();
  const edited = WORKFLOW.replace("script: test -f script-ok", "script: test -f other-ok");
  projectCopy(root, edited);
  write(root, "other-ok");
  runToEnd(root, "tiny", env);
  const result = check(root, workflow, env);
  expect(result.out).toContain("differs from the workflow under test");
  expect(result.code).toBe(1);
});
