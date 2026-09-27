// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ABC, Repo } from "./helpers";

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  repo.ok(["start", "feat", "--workflow", repo.workflow(ABC)]);
});
afterEach(() => repo.cleanup());

describe("next: ordering and depends_on", () => {
  test("prints exactly one instruction: the first runnable step in order", () => {
    const out = repo.ok(["next", "feat"]);
    expect(out).toContain("step: a");
    expect(out).toContain("instruction: do a");
    expect(out).toContain("produce: out/a.md");
    expect(out).toContain("then run: fuse-flow done feat a --artifact out/a.md");
    expect(out).not.toContain("step: b");
    expect(out).not.toContain("step: c");
  });

  test("a step without depends_on waits on the previous step", () => {
    const out = repo.fail(["done", "feat", "b"]);
    expect(out).toContain('step "b" waits on: a');
    expect(repo.state("feat").steps.b.fix_cycles).toBe(0);
  });

  test("depends_on: [] makes a step runnable out of order", () => {
    repo.write("out/c.md");
    const out = repo.ok(["done", "feat", "c"]);
    expect(out).toContain("c done");
    expect(repo.state("feat").steps.c.status).toBe("done");
    expect(repo.ok(["next", "feat"])).toContain("step: a");
  });

  test("after a is done, next moves to b and resolves its skill path", () => {
    repo.write("out/a.md");
    repo.ok(["done", "feat", "a"]);
    repo.env.FUSE_SKILLS_DIR = join(repo.root, "myskills");
    repo.write("myskills/some-skill/SKILL.md", "# skill\n");
    const out = repo.ok(["next", "feat"]);
    expect(out).toContain("step: b");
    expect(out).toContain(`read: ${join(repo.root, "myskills", "some-skill", "SKILL.md")}`);
    expect(out).not.toContain("not found");
    expect(out).toContain("gate: owner");
  });

  test("a missing skill file is reported, not hidden", () => {
    repo.write("out/a.md");
    repo.ok(["done", "feat", "a"]);
    const out = repo.ok(["next", "feat"]);
    expect(out).toContain("some-skill/SKILL.md");
    expect(out).toContain("not found");
  });

  test("a skill installed by Kiro CLI under .kiro/skills is found", () => {
    repo.write("out/a.md");
    repo.ok(["done", "feat", "a"]);
    delete repo.env.FUSE_SKILLS_DIR;
    repo.write(".kiro/skills/some-skill/SKILL.md", "# skill\n");
    const out = repo.ok(["next", "feat"]);
    expect(out).toMatch(/read: \S*\/\.kiro\/skills\/some-skill\/SKILL\.md\n/);
    expect(out).not.toContain("not found");
  });

  test("a stale .konductor/skills copy does not shadow the .kiro/skills one", () => {
    repo.write("out/a.md");
    repo.ok(["done", "feat", "a"]);
    delete repo.env.FUSE_SKILLS_DIR;
    repo.write(".konductor/skills/some-skill/SKILL.md", "# old\n");
    repo.write(".kiro/skills/some-skill/SKILL.md", "# current\n");
    const out = repo.ok(["next", "feat"]);
    expect(out).toMatch(/read: \S*\/\.kiro\/skills\/some-skill\/SKILL\.md\n/);
  });

  test("an explicit depends_on on a later step is honoured", () => {
    const wf = `version: 1
name: dep
steps:
  - id: one
    instruction: first
  - id: two
    instruction: second
    depends_on: [three]
  - id: three
    instruction: third
    depends_on: [one]
`;
    const r = new Repo();
    try {
      r.ok(["start", "d", "--workflow", r.workflow(wf)]);
      expect(r.ok(["next", "d"])).toContain("step: one");
      r.ok(["done", "d", "one"]);
      expect(r.ok(["next", "d"])).toContain("step: three");
      r.ok(["done", "d", "three"]);
      expect(r.ok(["next", "d"])).toContain("step: two");
      r.ok(["done", "d", "two"]);
      expect(r.ok(["next", "d"]).trim()).toBe("workflow complete");
    } finally {
      r.cleanup();
    }
  });

  test("prints workflow complete when nothing is left", () => {
    repo.write("out/a.md");
    repo.write("out/b.md");
    repo.write("out/c.md");
    repo.ok(["done", "feat", "a"]);
    repo.ok(["done", "feat", "b"]);
    repo.ok(["gate", "feat", "b", "--owner-approved"]);
    repo.ok(["done", "feat", "c"]);
    expect(repo.ok(["next", "feat"]).trim()).toBe("workflow complete");
  });

  test("an unknown slug is refused", () => {
    expect(repo.fail(["next", "nope"])).toContain("run fuse-flow start first");
  });
});
