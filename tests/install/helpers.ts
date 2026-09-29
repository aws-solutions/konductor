// SPDX-License-Identifier: Apache-2.0
// Test fixture for install.sh: a throwaway clone, home directory and project.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const SHELL = process.env.FUSE_INSTALL_SHELL ?? "sh";

export interface Run {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * A fresh clone with its own skills, a home directory and a project
 * directory, all under one temporary root. The clone is not a copy of this
 * repository: it has a different name and its own small set of skills, so
 * every test also checks that install.sh installs the content of the clone
 * it lives in.
 */
export class Sandbox {
  readonly root: string;
  readonly clone: string;
  readonly home: string;
  readonly project: string;

  constructor(skills: string[] = ["alpha", "beta"]) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "fuse-install-")));
    this.clone = join(this.root, "customer-fork");
    this.home = join(this.root, "home");
    this.project = join(this.root, "project");
    mkdirSync(this.clone);
    mkdirSync(this.home);
    mkdirSync(this.project);
    copyFileSync(join(REPO_ROOT, "install.sh"), join(this.clone, "install.sh"));
    this.setBlock("# fuse-konductor\n\nRules for the agent.\n");
    for (const name of skills) this.addSkill(name);
  }

  addSkill(name: string, body = `---\nname: ${name}\ndescription: Use when testing.\n---\n\n# ${name}\n`): void {
    mkdirSync(join(this.clone, "skills", name), { recursive: true });
    writeFileSync(join(this.clone, "skills", name, "SKILL.md"), body);
  }

  removeSkill(name: string): void {
    rmSync(join(this.clone, "skills", name), { recursive: true });
  }

  setBlock(text: string): void {
    writeFileSync(join(this.clone, "AGENTS.fuse.md"), text);
  }

  /** Directories put in front of PATH for every run, for example a fake `ln`. */
  pathPrefix: string[] = [];
  /** Extra environment variables for every run. */
  env: Record<string, string> = {};

  /** Makes `ln` fail from now on, as on a system without symlink support. */
  breakSymlinks(): void {
    const bin = join(this.root, "no-symlinks");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "ln"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    this.pathPrefix = [bin];
  }

  /**
   * Makes the next `mv` of a staged directory into place kill the script with
   * SIGTERM, as if the user interrupted it at the worst moment: instead of the
   * move, or right after it when `after` is set.
   */
  interruptNextStagedMove(after = false): void {
    const bin = join(this.root, "interrupt-mv");
    mkdirSync(bin, { recursive: true });
    const flag = join(this.root, "interrupt-flag");
    writeFileSync(flag, "");
    const realMv = spawnSync("sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(
      join(bin, "mv"),
      `#!/bin/sh\nfor a in "$@"; do src=$dst; dst=$a; done\n` +
        `case $src in */.fuse-konductor.*) if [ -d "$src" ] && [ -f "$FUSE_TEST_FLAG" ]; then rm -f "$FUSE_TEST_FLAG"; ` +
        (after ? `${realMv} "$@"; kill -TERM $PPID; exit 0` : `kill -TERM $PPID; exit 1`) +
        `; fi ;; esac\n` +
        `exec ${realMv} "$@"\n`,
      { mode: 0o755 },
    );
    this.pathPrefix = [...this.pathPrefix, bin];
    this.env.FUSE_TEST_FLAG = flag;
  }

  run(...args: string[]): Run {
    const path = [...this.pathPrefix, process.env.PATH ?? "/usr/bin:/bin"].join(":");
    const result = spawnSync(SHELL, [join(this.clone, "install.sh"), ...args], {
      cwd: this.root,
      env: { ...this.env, PATH: path, HOME: this.home },
      encoding: "utf8",
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    return { status: result.status ?? -1, stdout, stderr, output: stdout + stderr };
  }

  ok(...args: string[]): string {
    const result = this.run(...args);
    if (result.status !== 0) {
      throw new Error(`install.sh ${args.join(" ")} exited ${result.status}\n${result.output}`);
    }
    return result.output;
  }

  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }

  write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  read(path: string): string {
    return readFileSync(path, "utf8");
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export type Entry = { kind: "dir" } | { kind: "file"; content: string } | { kind: "link"; target: string };

/** Every path under `dir`, with file contents and link targets. Links are not followed. */
export function snapshot(dir: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  if (!existsSync(dir)) return out;
  const walk = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const key = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) out[key] = { kind: "link", target: readlinkSync(full) };
      else if (stat.isDirectory()) {
        out[key] = { kind: "dir" };
        walk(full, key);
      } else out[key] = { kind: "file", content: readFileSync(full, "latin1") };
    }
  };
  walk(dir, "");
  return out;
}

export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
