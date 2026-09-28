// SPDX-License-Identifier: Apache-2.0
// Where things are: the repository root, the workflow files, the state files
// fuse-flow keeps under <root>/.konductor, and the SKILL.md files that
// workflow steps name.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { FlowError, UsageError } from "./errors.ts";

// The nearest directory at or above `cwd` that contains `.git` (a directory in
// a normal clone, a file in a worktree). Outside any repository, `cwd` itself.
export function findRepoRoot(cwd: string): string {
  const start = realpathSync(resolve(cwd));
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

function homeDir(): string {
  return process.env.HOME ?? homedir();
}

// A workflow is named either by a path or by a name. A reference that
// contains a slash or ends in .yml or .yaml is a path; anything else is a name.
export function isWorkflowPath(ref: string): boolean {
  return ref.includes("/") || /\.ya?ml$/.test(ref);
}

// Where a workflow name is looked up, in this order: the project's own
// workflows, the user's, then the ones that ship with fuse-flow.
export function workflowDirs(root: string): string[] {
  return [
    join(root, ".konductor", "workflows"),
    join(homeDir(), ".konductor", "workflows"),
    join(import.meta.dirname, "..", "workflows"),
  ];
}

// The file a workflow reference points at: the path itself, or
// <name>.yml in the first directory that has it.
export function findWorkflow(root: string, ref: string): string {
  if (isWorkflowPath(ref)) return ref;
  const dirs = workflowDirs(root);
  const path = dirs.map((dir) => join(dir, `${ref}.yml`)).find((p) => existsSync(p));
  if (!path) throw new FlowError(`no workflow named "${ref}" in ${dirs.join(", ")}`);
  return path;
}

export function workstreamsDir(root: string): string {
  return join(root, ".konductor", "workstreams");
}

export function workstreamFile(root: string, slug: string): string {
  return join(workstreamsDir(root), `${slug}.yml`);
}

export function checkSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new UsageError(`slug "${slug}" must be lowercase letters, digits and hyphens`);
  }
}

// Skills are installed in different places depending on the harness, so a
// relative skill path is looked up in each of these directories in turn.
export function skillDirs(root: string): string[] {
  const home = homeDir();
  return [
    ...(process.env.FUSE_SKILLS_DIR ? [process.env.FUSE_SKILLS_DIR] : []),
    join(root, "skills"),
    join(root, ".kiro", "skills"),
    join(root, ".konductor", "skills"),
    join(root, ".claude", "skills"),
    ...(process.env.SKILLS_HOME ? [process.env.SKILLS_HOME] : []),
    join(home, ".kiro", "skills"),
    join(home, ".konductor", "skills"),
    join(home, ".claude", "skills"),
  ];
}

// The absolute path of a step's skill file, or undefined when no directory
// has it.
export function findSkill(root: string, skill: string): string | undefined {
  if (isAbsolute(skill)) return existsSync(skill) ? skill : undefined;
  return skillDirs(root)
    .map((dir) => join(dir, skill))
    .find((path) => existsSync(path));
}
