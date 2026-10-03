// SPDX-License-Identifier: Apache-2.0
// Where things are: the repository root, the workflow files, the state files
// fuse-flow keeps under <root>/.konductor, and the SKILL.md files that
// workflow steps name.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
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

// The folders of one workflows directory that a name is looked up in: the
// directory itself, then each folder directly inside it (such as personal/,
// or a team/ symlink to another repository), in alphabetical order.
function workflowFolders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const subfolders = readdirSync(dir)
    .sort()
    .map((name) => join(dir, name))
    .filter((path) => existsSync(path) && statSync(path).isDirectory());
  return [dir, ...subfolders];
}

// The file a workflow reference points at: the path itself, or <name>.yml in
// the first workflows directory that has it, at its top level or in one of its
// folders. A name found more than once in that directory is refused rather
// than guessed.
export function findWorkflow(root: string, ref: string): string {
  if (isWorkflowPath(ref)) return ref;
  const dirs = workflowDirs(root);
  for (const dir of dirs) {
    const found = workflowFolders(dir)
      .map((folder) => join(folder, `${ref}.yml`))
      .filter((path) => existsSync(path));
    if (found.length > 1) {
      throw new FlowError(`workflow name "${ref}" is ambiguous; rename one of: ${found.join(", ")}`);
    }
    if (found.length === 1) return found[0];
  }
  throw new FlowError(`no workflow named "${ref}" in ${dirs.join(", ")} or the folders directly inside them`);
}

export function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

// Every .yml and .yaml file below `dir`, in nested folders too, following
// symlinks. Skips node_modules, .git, and the project's workstream state files,
// which are YAML but not workflows.
export function workflowFilesBelow(root: string, dir: string): string[] {
  const skip = new Set([join(root, ".git"), workstreamsDir(root)].filter(existsSync).map((p) => realpathSync(p)));
  const files: string[] = [];
  const walk = (folder: string) => {
    const real = realpathSync(folder);
    if (skip.has(real)) return;
    skip.add(real); // a symlink loop is walked once
    for (const name of readdirSync(folder).sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const path = join(folder, name);
      if (isDirectory(path)) walk(path);
      else if (/\.ya?ml$/.test(name) && existsSync(path)) files.push(path);
    }
  };
  walk(dir);
  return files;
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
    join(root, ".agents", "skills"),
    ...(process.env.SKILLS_HOME ? [process.env.SKILLS_HOME] : []),
    join(home, ".kiro", "skills"),
    join(home, ".konductor", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".config", "opencode", "skills"),
    join(home, ".agents", "skills"),
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
