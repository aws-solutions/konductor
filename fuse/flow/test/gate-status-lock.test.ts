// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { ABC, Repo, SHIM } from "./helpers";

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  repo.ok(["start", "feat", "--workflow", repo.workflow(ABC)]);
});
afterEach(() => repo.cleanup());

describe("gate", () => {
  test("approves a step awaiting the owner and records the note", () => {
    repo.write("out/a.md");
    repo.write("out/b.md");
    repo.ok(["done", "feat", "a"]);
    const doneOut = repo.ok(["done", "feat", "b"]);
    expect(doneOut).toContain("b now awaits owner approval");
    expect(repo.ok(["next", "feat"])).toContain("step: b awaits owner approval");
    const out = repo.ok(["gate", "feat", "b", "--owner-approved", "--note", "looks right"]);
    expect(out).toContain("b: owner approved (was awaiting-owner); step done");
    const st = repo.state("feat").steps.b;
    expect(st.status).toBe("done");
    expect(st.gate).toEqual(expect.objectContaining({ outcome: "owner-approved", note: "looks right" }));
  });

  test("refuses without --owner-approved", () => {
    expect(repo.fail(["gate", "feat", "b"])).toContain("pass --owner-approved");
  });

  test("refuses a step that is still pending", () => {
    const out = repo.fail(["gate", "feat", "b", "--owner-approved"]);
    expect(out).toContain('step "b" is pending');
    expect(repo.state("feat").steps.b.status).toBe("pending");
  });

  test("unblocks a blocked step as an owner decision", () => {
    repo.fail(["done", "feat", "a"]);
    repo.fail(["done", "feat", "a"]);
    expect(repo.state("feat").steps.a.status).toBe("blocked");
    const out = repo.ok(["gate", "feat", "a", "--owner-approved", "--note", "accept as is"]);
    expect(out).toContain("(was blocked)");
    expect(repo.ok(["next", "feat"])).toContain("step: b");
  });
});

describe("status", () => {
  test("lists every step with state, gate and dependencies", () => {
    repo.write("out/a.md");
    repo.ok(["done", "feat", "a"]);
    const out = repo.ok(["status", "feat"]);
    expect(out).toContain("workstream feat (abc)");
    expect(out).toMatch(/a\s+done\s+gate none\s+out\/a\.md/);
    expect(out).toMatch(/b\s+pending\s+gate owner/);
    expect(out).toMatch(/c\s+pending\s+gate none/);
    expect(out).not.toContain("waits on");
    expect(out).toContain("next: fuse-flow next feat");
  });

  test("shows fix cycles and reports completion", () => {
    repo.fail(["done", "feat", "a"]);
    expect(repo.ok(["status", "feat"])).toMatch(/a\s+pending\s+gate none\s+fix cycles 1/);
    repo.write("out/a.md");
    repo.write("out/b.md");
    repo.write("out/c.md");
    repo.ok(["done", "feat", "a"]);
    repo.ok(["done", "feat", "b"]);
    repo.ok(["gate", "feat", "b", "--owner-approved"]);
    repo.ok(["done", "feat", "c"]);
    expect(repo.ok(["status", "feat"])).toContain("workflow complete");
  });
});

describe("lock", () => {
  test("a held lock makes writes wait and then refuse; state is untouched", () => {
    repo.write("out/a.md");
    writeFileSync(repo.lockPath("feat"), "99999\n");
    const before = repo.state("feat");
    const out = repo.fail(["done", "feat", "a"]);
    expect(out).toContain("another fuse-flow process holds");
    expect(repo.state("feat")).toEqual(before);
    expect(existsSync(repo.lockPath("feat"))).toBe(true);
  });

  test("a stale lock is stolen", () => {
    repo.write("out/a.md");
    writeFileSync(repo.lockPath("feat"), "99999\n");
    const old = new Date(Date.now() - 120_000);
    utimesSync(repo.lockPath("feat"), old, old);
    expect(repo.ok(["done", "feat", "a"])).toContain("a done");
    expect(existsSync(repo.lockPath("feat"))).toBe(false);
  });

  test("reads do not need the lock", () => {
    writeFileSync(repo.lockPath("feat"), "99999\n");
    expect(repo.ok(["next", "feat"])).toContain("step: a");
    expect(repo.ok(["status", "feat"])).toContain("workstream feat");
  });

  test("two concurrent done calls on one step: exactly one is recorded", async () => {
    repo.write("out/a.md");
    repo.env.FUSE_FLOW_LOCK_TIMEOUT_MS = "5000";
    const spawn = () =>
      Bun.spawn([process.execPath, "run", `${import.meta.dir}/../src/cli.ts`, "done", "feat", "a"], {
        cwd: repo.root,
        env: repo.env,
        stdout: "pipe",
        stderr: "pipe",
      });
    const procs = [spawn(), spawn(), spawn()];
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes.filter((c) => c === 0)).toHaveLength(1);
    expect(codes.filter((c) => c === 1)).toHaveLength(2);
    expect(repo.state("feat").steps.a.status).toBe("done");
    expect(repo.state("feat").steps.a.fix_cycles).toBe(0);
  });
});

describe("validation and usage", () => {
  test("a bad gate is refused with the field named", () => {
    const bad = repo.write("bad.yml", `version: 1\nname: bad\nsteps:\n  - id: a\n    instruction: x\n    gate: sometimes\n`);
    const out = repo.fail(["start", "b", "--workflow", bad]);
    expect(out).toContain("not a valid workflow");
    expect(out).toContain("steps.0.gate");
    expect(out).toContain("check:<command>");
  });

  test("a duplicate step id is refused", () => {
    const bad = repo.write("bad.yml", `version: 1\nname: bad\nsteps:\n  - id: a\n    instruction: x\n  - id: a\n    instruction: y\n`);
    const out = repo.fail(["start", "b", "--workflow", bad]);
    expect(out).toContain('duplicate step id "a"');
  });

  test("a step needs a skill or an instruction, and depends_on must name real steps", () => {
    const bad = repo.write("bad.yml", `version: 1\nname: bad\nsteps:\n  - id: a\n    depends_on: [zzz]\n`);
    const out = repo.fail(["start", "b", "--workflow", bad]);
    expect(out).toContain("a step needs a skill path, an inline instruction, or both");
    expect(out).toContain('unknown step "zzz"');
  });

  test("a corrupted state file is refused, not repaired silently", () => {
    writeFileSync(repo.statePath("feat"), "version: 1\nslug: feat\nsteps: nonsense\n");
    expect(repo.fail(["next", "feat"])).toContain("not a valid workstream");
  });

  test("no command or a wrong arity is a usage error (64)", () => {
    expect(repo.run([]).code).toBe(64);
    expect(repo.fail(["next"], 64)).toContain("usage:");
    expect(repo.fail(["frobnicate"], 64)).toContain("unknown command");
  });

  test("the fuse-flow shim runs the CLI", () => {
    const proc = Bun.spawnSync([SHIM, "status", "feat"], { cwd: repo.root, env: repo.env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout)).toContain("workstream feat (abc)");
  });
});
