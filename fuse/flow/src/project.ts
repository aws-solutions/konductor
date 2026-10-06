// SPDX-License-Identifier: Apache-2.0
// Where things are: the repository root, the workflow files, the state files
// fuse-flow keeps under <root>/.konductor, the policy files and the libraries
// of artifact guides.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

// The file a workflow reference points at: the path itself, or <name>.yml in
// the first workflows directory that has it, at any depth below it (such as
// examples/superpowers/, personal/, or a team/ symlink to another repository).
// A name found more than once in that directory is refused rather than guessed.
export function findWorkflow(root: string, ref: string): string {
  if (isWorkflowPath(ref)) return ref;
  const dirs = workflowDirs(root);
  for (const dir of dirs) {
    if (!isDirectory(dir)) continue;
    const found = workflowFilesBelow(root, dir).filter((path) => basename(path) === `${ref}.yml`);
    if (found.length > 1) {
      throw new FlowError(`workflow name "${ref}" is ambiguous; rename one of: ${found.join(", ")}`);
    }
    if (found.length === 1) return found[0];
  }
  throw new FlowError(`no workflow named "${ref}" in ${dirs.join(", ")} or any folder below them`);
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

// Where the reviewers of one workstream write their findings files.
export function reviewsDir(root: string, slug: string): string {
  return join(root, ".konductor", "reviews", slug);
}

export function workstreamFile(root: string, slug: string): string {
  return join(workstreamsDir(root), `${slug}.yml`);
}

export function checkSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new UsageError(`slug "${slug}" must be lowercase letters, digits and hyphens`);
  }
}

// Where artifact guides are looked up, the most specific first: the project's
// own library, the user's, then the one that ships with fuse-flow. Each holds
// artifacts/<id>/ folders (decisions 16, 24 and 29).
export function libraryDirs(root: string): { project: string; user: string; package: string } {
  return {
    project: join(root, ".konductor", "library"),
    user: join(homeDir(), ".konductor", "library"),
    package: join(import.meta.dirname, "..", "library"),
  };
}

// The policy files, from the most general to the most specific (decision 44).
export function policyFiles(root: string): { user: string; team: string; local: string } {
  return {
    user: join(homeDir(), ".konductor", "policy-overrides.yml"),
    team: join(root, ".konductor", "policy-overrides.yml"),
    local: join(root, ".konductor", "policy-overrides.local.yml"),
  };
}
