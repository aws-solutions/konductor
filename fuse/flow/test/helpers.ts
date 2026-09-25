// SPDX-License-Identifier: Apache-2.0
// Test helpers: a throwaway git repository per test and a runner that
// invokes the real CLI as a subprocess.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const FLOW_DIR = resolve(import.meta.dir, "..");
export const CLI = join(FLOW_DIR, "src", "cli.ts");
export const SHIM = join(FLOW_DIR, "fuse-flow");
export const SDLC_WORKFLOW = join(FLOW_DIR, "workflows", "_k-full-sdlc.yml");
export const PHASE_CHAIN_WORKFLOW = join(FLOW_DIR, "workflows", "_k-phase-chain.yml");

export interface Run {
  code: number;
  out: string;
}

export class Repo {
  readonly root: string;
  env: Record<string, string>;

  constructor() {
    const base = process.env.KIROCREW_SCRATCH ?? process.env.TMPDIR ?? tmpdir();
    this.root = realpathSync(mkdtempSync(join(base, "fuse-flow-test-")));
    mkdirSync(join(this.root, ".git"));
    this.env = {
      ...(process.env as Record<string, string>),
      HOME: join(this.root, "home"),
      FUSE_FLOW_LOCK_TIMEOUT_MS: "300",
    };
    mkdirSync(this.env.HOME);
  }

  write(rel: string, content = "x\n"): string {
    const p = join(this.root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
    return p;
  }

  workflow(yaml: string): string {
    return this.write("wf.yml", yaml);
  }

  run(args: string[], cwd = this.root): Run {
    const proc = Bun.spawnSync([process.execPath, "run", CLI, ...args], {
      cwd,
      env: this.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
    return { code: proc.exitCode, out };
  }

  ok(args: string[]): string {
    const r = this.run(args);
    if (r.code !== 0) throw new Error(`expected exit 0 for ${args.join(" ")}, got ${r.code}:\n${r.out}`);
    return r.out;
  }

  fail(args: string[], code = 1): string {
    const r = this.run(args);
    if (r.code !== code) throw new Error(`expected exit ${code} for ${args.join(" ")}, got ${r.code}:\n${r.out}`);
    return r.out;
  }

  statePath(slug: string): string {
    return join(this.root, ".konductor", "workstreams", `${slug}.yml`);
  }

  lockPath(slug: string): string {
    return join(this.root, ".konductor", "workstreams", `${slug}.lock`);
  }

  state(slug: string): any {
    return Bun.YAML.parse(readFileSync(this.statePath(slug), "utf8"));
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

// A three-step workflow: b follows a by default, c is independent.
export const ABC = `version: 1
name: abc
steps:
  - id: a
    instruction: do a
    produces: [out/a.md]
  - id: b
    skill: some-skill/SKILL.md
    produces: [out/b.md]
    gate: owner
  - id: c
    instruction: do c
    produces: [out/c.md]
    depends_on: []
`;
