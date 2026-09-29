// SPDX-License-Identifier: Apache-2.0
// Pins this package's `.konductor/` gitignore semantics: runtime state is
// ignored, shared configuration is not.
//
// Two rules carry that split, and they must be read together:
//
// - `.konductor/*` ignores every direct child of the repo-root `.konductor/`,
//   so per-developer runtime state (`memory/MEMORY.md`, `memory/USER.md` and
//   `.config.lock`) cannot be accidentally staged.
// - `!.konductor/memory-config.json` is the only re-inclusion.
//
// The first two tests are mutation-sensitive only as a pair. Deleting
// `.konductor/*` outright would leave the "config is not ignored" test green,
// because nothing would be ignored, so the "runtime state is ignored" test is
// what catches that. Do not drop one and keep the other.
//
// Everything is checked with `git check-ignore` against a copy of the real
// `.gitignore` in a scratch repository under the system temporary directory,
// never by reasoning about gitignore precedence rules. Nothing is written
// under the real working tree.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const GITIGNORE = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "fuse-gitignore-")));
  const init = spawnSync("git", ["init", "-q"], { cwd: root });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  writeFileSync(join(root, ".gitignore"), GITIGNORE);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Creates a probe file under the scratch repository and returns its path. */
const make = (relpath: string): string => {
  const path = join(root, relpath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "probe\n");
  return path;
};

/** Ground truth: would `git add` skip this path? */
const isIgnored = (relpath: string): boolean => spawnSync("git", ["check-ignore", "-q", relpath], { cwd: root }).status === 0;

const isInside = (path: string, dir: string): boolean => {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
};

describe(".gitignore rules for .konductor/", () => {
  // Per-developer memory state must stay untrackable. This is also the test
  // that catches outright deletion of the `.konductor/*` rule.
  //
  // The third probe is a dot-prefixed direct child of `.konductor/`, unlike the
  // two nested `memory/` probes: a gitignore `*` matches dotfiles, so
  // `.konductor/*` covers it, and narrowing that rule to `.konductor/memory/`
  // would leave it trackable while the first two probes stayed green.
  test("runtime state is ignored", () => {
    for (const probe of [".konductor/memory/MEMORY.md", ".konductor/memory/USER.md", ".konductor/.config.lock"]) {
      const path = make(probe);
      expect(isIgnored(relative(root, path)), `${probe} holds per-developer state and must stay gitignored`).toBe(true);
    }
  });

  // `memory-config.json` is shared configuration, so the `.konductor/*` rule
  // must not shadow it. Probed by path: `git check-ignore` evaluates patterns
  // without requiring the file to exist.
  test("memory-config.json is not ignored", () => {
    expect(isIgnored(".konductor/memory-config.json"), ".konductor/memory-config.json is shared config and must stay trackable").toBe(false);
  });

  // The internal slash in `.konductor/*` anchors it to the repo root, so a
  // nested `.konductor/` is not covered. This pins the anchoring as a
  // deliberate choice: stray nested state shows up in `git status` instead of
  // being silently ignored, which a depth-agnostic `**/.konductor/*` would do.
  // It matches memory-validator.sh, which resolves its target through
  // `git rev-parse --show-toplevel`.
  test("the rule is anchored to the repository root", () => {
    const path = make("sub/.konductor/memory/MEMORY.md");
    expect(isIgnored(relative(root, path))).toBe(false);
  });

  // This package has no legacy state to guard, so the pre-rename roots must
  // NOT be ignored: a lingering guard is dead configuration that implies
  // legacy is still a supported state.
  test("no legacy root guards remain", () => {
    for (const probe of [".memory/MEMORY.md", ".asdlc/memory/MEMORY.md"]) {
      const path = make(probe);
      expect(isIgnored(relative(root, path)), `${probe} is ignored, meaning a legacy-root guard was reintroduced into .gitignore`).toBe(false);
    }
  });

  test("the scratch repository never touches the real working tree", () => {
    expect(root).not.toBe(REPO_ROOT);
    expect(isInside(root, REPO_ROOT)).toBe(false);
    const path = make(".konductor/memory/MEMORY.md");
    expect(isInside(path, REPO_ROOT), "probe file escaped the scratch directory into the real working tree").toBe(false);
  });
});
