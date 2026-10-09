// SPDX-License-Identifier: Apache-2.0
// Test harness: every test gets a throwaway git repository and drives the
// real fuse-flow command line in a subprocess, exactly as an agent would.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const FLOW_DIR = resolve(import.meta.dir, "..");
const CLI = join(FLOW_DIR, "src", "cli.ts");

export interface Result {
  code: number;
  out: string;
}

export class Repo {
  readonly root: string;
  readonly env: Record<string, string>;

  constructor() {
    const base = process.env.KIROCREW_SCRATCH ?? tmpdir();
    this.root = realpathSync(mkdtempSync(join(base, "fuse-flow-test-")));
    mkdirSync(join(this.root, ".git"));
    // A private HOME, so the test machine's own workflows, library and policy
    // are not found.
    this.env = { ...(process.env as Record<string, string>), HOME: join(this.root, "home") };
    delete this.env.FUSE_FLOW_COMMAND;
  }

  write(path: string, content = "x\n"): string {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  }

  cleanupPath(path: string): void {
    rmSync(join(this.root, path), { recursive: true, force: true });
  }

  read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }

  // Run `fuse-flow <args>` in `cwd` (the repository root by default).
  run(args: string[], cwd = this.root, command = [process.execPath, "run", CLI]): Result {
    const proc = Bun.spawnSync([...command, ...args], { cwd, env: this.env, stdout: "pipe", stderr: "pipe" });
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
  }

  // The same, without waiting: for commands that must overlap.
  async runInBackground(args: string[]): Promise<Result> {
    const proc = Bun.spawn([process.execPath, "run", CLI, ...args], { cwd: this.root, env: this.env, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, out: out + err };
  }

  ok(...args: string[]): string {
    return this.expect(0, args);
  }

  refused(...args: string[]): string {
    return this.expect(1, args);
  }

  usage(...args: string[]): string {
    return this.expect(64, args);
  }

  private expect(code: number, args: string[]): string {
    const r = this.run(args);
    if (r.code !== code) throw new Error(`fuse-flow ${args.join(" ")}: expected exit ${code}, got ${r.code}\n${r.out}`);
    return r.out;
  }

  // Install `yaml` as the workflow and mint workstream `slug`.
  start(slug: string, yaml: string): string {
    return this.ok("start", slug, "--workflow", this.write("workflow-source.yml", yaml));
  }

  state(slug: string): any {
    return Bun.YAML.parse(this.read(`.konductor/workstreams/${slug}.yml`));
  }

  status(slug: string, step: string): string {
    return this.state(slug).steps[step].status;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
