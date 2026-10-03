// SPDX-License-Identifier: Apache-2.0
// The workflow file: choosing it by name or path, changing it mid-workstream,
// rejecting invalid ones, finding the skills its steps name, and the
// workflows shipped in fuse/flow/workflows.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { FLOW_DIR, REPO_SKILLS, Repo } from "./helpers";

const ONE_STEP = `version: 1
name: one
steps:
  - id: only
    skill: demo/SKILL.md
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

describe("choosing the workflow", () => {
  test("a new workstream needs --workflow; resuming one does not", () => {
    expect(repo.refused("start", "feat")).toContain("a new workstream needs --workflow <name or path>");
    repo.start("feat", ONE_STEP);
    expect(repo.ok("start", "feat")).toContain("resumed workstream feat");
  });

  test("resuming with the same workflow is fine; a different one is refused", () => {
    repo.start("feat", ONE_STEP);
    repo.ok("start", "feat", "--workflow", join(repo.root, "workflow-source.yml"));
    const different = repo.write("different.yml", ONE_STEP);
    expect(repo.refused("start", "feat", "--workflow", different)).toContain(
      `workstream feat follows workflow ${join(repo.root, "workflow-source.yml")}, not ${different}`,
    );
  });

  test("a workflow path is relative to the current directory and recorded as an absolute path", () => {
    repo.write("sub/wf.yml", ONE_STEP);
    const r = repo.run(["start", "feat", "--workflow", "wf.yml"], join(repo.root, "sub"));
    expect(r.code).toBe(0);
    expect(repo.state("feat").workflow).toBe(join(repo.root, "sub/wf.yml"));
  });

  test("a name is looked up in the project, then the home directory, then the shipped workflows", () => {
    repo.ok("start", "shipped", "--workflow", "_k-phase-chain");
    expect(repo.state("shipped").workflow).toBe("_k-phase-chain");
    expect(repo.ok("status", "shipped")).toStartWith("workstream shipped (k-phase-chain)");

    repo.write("home/.konductor/workflows/mine.yml", ONE_STEP.replace("name: one", "name: from-home"));
    repo.ok("start", "feat", "--workflow", "mine");
    expect(repo.ok("status", "feat")).toStartWith("workstream feat (from-home)");

    // The name is resolved again on every command, so a project workflow
    // added later takes over.
    repo.write(".konductor/workflows/mine.yml", ONE_STEP.replace("name: one", "name: from-project"));
    expect(repo.ok("status", "feat")).toStartWith("workstream feat (from-project)");

    expect(repo.refused("start", "other", "--workflow", "nope")).toContain('no workflow named "nope" in');
  });

  test("a name is also found in a subfolder of a workflows directory, including a symlinked one", () => {
    repo.write(".konductor/workflows/personal/mine.yml", ONE_STEP.replace("name: one", "name: personal"));
    repo.ok("start", "feat", "--workflow", "mine");
    expect(repo.state("feat").workflow).toBe("mine");
    expect(repo.ok("status", "feat")).toStartWith("workstream feat (personal)");

    repo.write("team-repo/shared.yml", ONE_STEP.replace("name: one", "name: team"));
    symlinkSync(join(repo.root, "team-repo"), join(repo.root, ".konductor/workflows/team"));
    repo.ok("start", "other", "--workflow", "shared");
    expect(repo.ok("status", "other")).toStartWith("workstream other (team)");
  });

  test("a name found twice in one workflows directory is refused with both paths", () => {
    const top = repo.write(".konductor/workflows/mine.yml", ONE_STEP);
    const personal = repo.write(".konductor/workflows/personal/mine.yml", ONE_STEP);
    const out = repo.refused("start", "feat", "--workflow", "mine");
    expect(out).toContain('workflow name "mine" is ambiguous');
    expect(out).toContain(top);
    expect(out).toContain(personal);
  });

  test("workstreams in one repository can follow different workflows", () => {
    repo.start("one", ONE_STEP);
    repo.ok("start", "two", "--workflow", "_k-phase-chain");
    expect(repo.ok("start", "one")).toContain("step: only");
    expect(repo.ok("start", "two")).not.toContain("step: only");
  });
});

describe("changing the workflow of a running workstream", () => {
  test("a step added to the workflow is pending straight away", () => {
    repo.start("feat", ONE_STEP);
    expect(repo.ok("continue", "feat")).toEndWith("workflow complete\n");

    repo.write("workflow-source.yml", ONE_STEP + "  - id: added\n    instruction: new work\n");
    expect(repo.ok("status", "feat")).toContain("> added");
    expect(repo.ok("start", "feat")).toContain("step: added"); // and writes the new step into the state file
    expect(repo.status("feat", "added")).toBe("pending");
  });
});

describe("invalid workflows are refused with the reason", () => {
  const cases: Array<[string, string, string]> = [
    ["not YAML", "version: 1\nsteps: [", "is not valid YAML"],
    ["unknown field", ONE_STEP + "    owner: me\n", "Unrecognized key"],
    ["duplicate step id", ONE_STEP + "  - id: only\n    instruction: again\n", 'duplicate step id "only"'],
    [
      "dependency on a later step",
      `version: 1
name: x
steps:
  - id: a
    instruction: a
    depends_on: [b]
  - id: b
    instruction: b
`,
      '"a" depends on "b", which is not a step listed before it',
    ],
    ["bad gate", ONE_STEP + "    gate: sometimes\n", 'must be owner-action("…"), script("…") or agent("…"), as a string or a one-key mapping (a mapping may add description and route_back_to, and an agent mapping max_rounds: <n>), got "sometimes"'],
    ["empty check", ONE_STEP + '    gate: "check:"\n', 'must be owner-action("…"), script("…") or agent("…"), as a string or a one-key mapping (a mapping may add description and route_back_to, and an agent mapping max_rounds: <n>), got "check:"'],
    ["step with nothing to do", "version: 1\nname: x\nsteps:\n  - id: a\n", "a step needs a skill, an instruction, or both"],
    ["agent gate max_rounds below 1", ONE_STEP + "    gate: { agent: review, max_rounds: 0 }\n", "steps.0.gate.max_rounds: Too small: expected number to be >=1"],
    ["max_rounds on a script gate", ONE_STEP + "    gate: { script: bun test, max_rounds: 2 }\n", 'got {"script":"bun test","max_rounds":2}'],
    ["route_back_to a later step", "version: 1\nname: one\nsteps:\n  - id: a\n    instruction: x\n    gate: { agent: review, route_back_to: b }\n  - id: b\n    instruction: y\n", '"a" routes back to "b", which is not this step or a step listed before it'],
    ["route_back_to a bad step id", ONE_STEP + "    gate: { agent: review, route_back_to: Design }\n", "route_back_to"],
    ["max_fix_cycles, which fuse-flow no longer reads", "version: 1\nname: one\nmax_fix_cycles: 2\nsteps:\n  - id: only\n    instruction: x\n", "max_fix_cycles"],
    ["bad step id", "version: 1\nname: x\nsteps:\n  - id: Design\n    instruction: x\n", "lowercase letters"],
  ];
  for (const [name, yaml, message] of cases) {
    test(name, () => {
      const out = repo.refused("start", "feat", "--workflow", repo.write("bad.yml", yaml));
      expect(out).toContain("bad.yml");
      expect(out).toContain(message);
    });
  }
});

test("the workflow, its steps and its mapping gates take a free-text description, which changes nothing", () => {
  const out = repo.start(
    "feat",
    `version: 1
name: described
description: A workflow with notes.
steps:
  - id: only
    description: Why this step exists.
    instruction: x
    gates:
      - script: "true"
        description: The suite must stay green.
      - agent: review it
        description: An independent review.
        max_rounds: 3
      - owner-action: approve
        description: The owner signs off.
`,
  );
  expect(out).toContain("script gate: true");
  expect(out).toContain("After 3 such rounds");
  expect(out).not.toContain("Why this step exists");
  expect(out).not.toContain("The suite must stay green");
  expect(repo.refused("start", "other", "--workflow", repo.write("bad.yml", ONE_STEP + "    gate: { script: x, description: 3 }\n"))).toContain(
    'got {"script":"x","description":3}',
  );
});

describe("finding skills", () => {
  test("FUSE_SKILLS_DIR comes first, then the repository, then SKILLS_HOME, then the home directory", () => {
    repo.start("feat", ONE_STEP);
    const where = () => repo.ok("start", "feat").split("\n")[5];
    expect(where()).toBe("read: demo/SKILL.md   (not found; set FUSE_SKILLS_DIR)");

    repo.write("home/.config/opencode/skills/demo/SKILL.md");
    expect(where()).toBe(`read: ${join(repo.root, "home/.config/opencode/skills/demo/SKILL.md")}`);
    repo.write("home/.codex/skills/demo/SKILL.md");
    expect(where()).toBe(`read: ${join(repo.root, "home/.codex/skills/demo/SKILL.md")}`);
    repo.write("home/.claude/skills/demo/SKILL.md");
    expect(where()).toBe(`read: ${join(repo.root, "home/.claude/skills/demo/SKILL.md")}`);
    repo.write("custom-skills/demo/SKILL.md");
    repo.env.SKILLS_HOME = join(repo.root, "custom-skills");
    expect(where()).toBe(`read: ${join(repo.root, "custom-skills/demo/SKILL.md")}`);
    repo.write(".kiro/skills/demo/SKILL.md");
    expect(where()).toBe(`read: ${join(repo.root, ".kiro/skills/demo/SKILL.md")}`);
    repo.write("elsewhere/demo/SKILL.md");
    repo.env.FUSE_SKILLS_DIR = join(repo.root, "elsewhere");
    expect(where()).toBe(`read: ${join(repo.root, "elsewhere/demo/SKILL.md")}`);
  });
});

describe("the workflows shipped in fuse/flow/workflows", () => {
  const shipped = readdirSync(join(FLOW_DIR, "workflows")).filter((f) => f.endsWith(".yml"));

  test("there are six of them", () => {
    expect(shipped.sort()).toEqual([
      "_k-full-sdlc.yml",
      "_k-phase-chain.yml",
      "custom-example-ambiguous.yml",
      "custom-example-large.yml",
      "custom-example-medium.yml",
      "custom-example-small.yml",
    ]);
  });

  for (const file of shipped) {
    test(`${file} starts by name, and every skill it names exists in this repository`, () => {
      repo.ok("start", "feat", "--workflow", file.replace(/\.yml$/, ""));
      repo.env.FUSE_SKILLS_DIR = REPO_SKILLS;
      const text = readFileSync(join(FLOW_DIR, "workflows", file), "utf8");
      const workflow = Bun.YAML.parse(text) as { steps: Array<{ skill?: string }> };
      const skills = workflow.steps.flatMap((s) => s.skill ?? []);
      for (const skill of skills) expect(existsSync(join(REPO_SKILLS, skill))).toBe(true);
      expect(repo.ok("start", "feat")).not.toContain("not found");
    });
  }
});

describe("the workflow JSON Schema", () => {
  const SCHEMA = join(FLOW_DIR, "workflows", "schemas", "workflow.schema.json");

  test("the JSON Schema files are what `bun run schema` writes from the Zod schemas", () => {
    const proc = Bun.spawnSync([process.execPath, "run", "schema", "--check"], { cwd: FLOW_DIR, stdout: "pipe", stderr: "pipe" });
    expect(proc.stdout.toString() + proc.stderr.toString()).toContain("is up to date");
    expect(proc.exitCode).toBe(0);
  });

  // Only the tracked workflows: personal/ and team/ are gitignored and often symlinks.
  const files = readdirSync(join(FLOW_DIR, "workflows")).filter((f) => f.endsWith(".yml"));
  for (const file of files) {
    test(`${file} names schemas/workflow.schema.json for WebStorm and for VS Code`, () => {
      const text = readFileSync(join(FLOW_DIR, "workflows", file), "utf8");
      const webstorm = /^# \$schema: (\S+)$/m.exec(text)?.[1];
      const vscode = /^# yaml-language-server: \$schema=(\S+)$/m.exec(text)?.[1];
      for (const path of [webstorm, vscode]) {
        expect(path).toBeDefined();
        expect(resolve(FLOW_DIR, "workflows", path!)).toBe(SCHEMA);
      }
    });
  }
});
