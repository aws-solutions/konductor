// SPDX-License-Identifier: Apache-2.0
// End-to-end tests for the mechanical smoke verdict: each test builds a
// throwaway project, drives the real fuse-flow command line through a small
// workflow exactly as an agent would, then runs check.ts on the result.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SMOKE_DIR = resolve(import.meta.dir, "..");
const FLOW_CLI = resolve(SMOKE_DIR, "..", "flow", "src", "cli.ts");
const CHECK = join(SMOKE_DIR, "check.ts");

const WORKFLOW = `version: 1
name: tiny
steps:
  - id: write
    instruction: write the note
    produces: [notes/note.md]
  - id: approve
    instruction: ask the owner
    produces: [notes/approval.md]
    gate: owner
  - id: verify
    instruction: make the check pass
    gate: "check: test -f ok.txt"
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
  const env = { ...(process.env as Record<string, string>), HOME: join(root, "home") };
  return { root, workflow, env };
}

function write(root: string, path: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), "x\n");
}

function flow(root: string, env: Record<string, string>, ...args: string[]): void {
  const r = Bun.spawnSync(["bun", FLOW_CLI, ...args], { cwd: root, env });
  if (r.exitCode !== 0) throw new Error(`fuse-flow ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`);
}

function check(root: string, workflow: string, env: Record<string, string>): { code: number; out: string } {
  const r = Bun.spawnSync(["bun", CHECK, "--project", root, "--workflow", workflow], { cwd: root, env });
  return { code: r.exitCode ?? -1, out: `${r.stdout}${r.stderr}` };
}

function runToEnd(root: string, workflow: string, env: Record<string, string>): void {
  flow(root, env, "start", "hello", "--workflow", workflow);
  write(root, "notes/note.md");
  flow(root, env, "continue", "hello");
  write(root, "notes/approval.md");
  flow(root, env, "continue", "hello");
  flow(root, env, "continue", "hello", "--owner-approved", "--note", "looks fine");
  write(root, "ok.txt");
  flow(root, env, "continue", "hello");
}

test("a workstream that ran every step to the end passes", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  const r = check(root, workflow, env);
  expect(r.out).toContain("MECHANICAL: PASS");
  expect(r.out).toContain("owner approved: looks fine");
  expect(r.code).toBe(0);
});

test("a workstream that stopped part way fails and names the unfinished steps", () => {
  const { root, workflow, env } = project();
  flow(root, env, "start", "hello", "--workflow", workflow);
  write(root, "notes/note.md");
  flow(root, env, "continue", "hello");
  const r = check(root, workflow, env);
  expect(r.out).toContain("MECHANICAL: FAIL");
  expect(r.out).toContain("approve: not done (pending)");
  expect(r.out).toContain("verify: not done (pending)");
  expect(r.code).toBe(1);
});

test("an artifact removed after its step was recorded fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  rmSync(join(root, "notes/note.md"));
  const r = check(root, workflow, env);
  expect(r.out).toContain("write: missing artifact notes/note.md");
  expect(r.out).toContain("MECHANICAL: FAIL");
  expect(r.code).toBe(1);
});

test("a check gate that no longer passes fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  rmSync(join(root, "ok.txt"));
  const r = check(root, workflow, env);
  expect(r.out).toContain("verify: check failed: test -f ok.txt");
  expect(r.out).toContain("MECHANICAL: FAIL");
  expect(r.code).toBe(1);
});

test("a project with no workstream fails", () => {
  const { root, workflow, env } = project();
  const r = check(root, workflow, env);
  expect(r.out).toContain("no workstream");
  expect(r.out).toContain("MECHANICAL: FAIL");
  expect(r.code).toBe(1);
});

test("a workstream that follows a different workflow fails", () => {
  const { root, workflow, env } = project();
  runToEnd(root, workflow, env);
  const other = join(root, "other.yml");
  writeFileSync(other, WORKFLOW.replace("name: tiny", "name: other"));
  const r = check(root, other, env);
  expect(r.out).toContain("follows");
  expect(r.out).toContain("MECHANICAL: FAIL");
  expect(r.code).toBe(1);
});

// A fixture workflow is copied into the project so the fuse agent can name
// it; the run is checked against the harness's own copy.
function projectCopy(root: string, text: string): void {
  mkdirSync(join(root, ".konductor", "workflows"), { recursive: true });
  writeFileSync(join(root, ".konductor", "workflows", "tiny.yml"), text);
}

test("a workstream that follows an unchanged project copy of the workflow passes", () => {
  const { root, workflow, env } = project();
  projectCopy(root, WORKFLOW);
  runToEnd(root, "tiny", env);
  const r = check(root, workflow, env);
  expect(r.out).toContain("MECHANICAL: PASS");
  expect(r.code).toBe(0);
});

test("a workstream that follows an edited project copy of the workflow fails", () => {
  const { root, workflow, env } = project();
  projectCopy(root, WORKFLOW.replace("check: test -f ok.txt", "check: true"));
  runToEnd(root, "tiny", env);
  const r = check(root, workflow, env);
  expect(r.out).toContain("differs from the workflow under test");
  expect(r.out).toContain("MECHANICAL: FAIL");
  expect(r.code).toBe(1);
});
