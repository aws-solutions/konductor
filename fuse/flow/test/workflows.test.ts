// SPDX-License-Identifier: Apache-2.0
// The workflow file: choosing it by name or path, changing it mid-workstream,
// rejecting invalid ones, finding its artifacts' guides in the library, and
// the workflows shipped in fuse/flow/workflows.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { FLOW_DIR, Repo } from "./helpers";

const ONE_STEP = `version: 1
name: one
steps:
  - id: only
    instruction: Do the one thing.
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

  test("a name is found at any depth of a workflows directory, including through a symlink", () => {
    repo.write(".konductor/workflows/personal/mine.yml", ONE_STEP.replace("name: one", "name: personal"));
    repo.ok("start", "feat", "--workflow", "mine");
    expect(repo.state("feat").workflow).toBe("mine");
    expect(repo.ok("status", "feat")).toStartWith("workstream feat (personal)");

    repo.write("team-repo/shared.yml", ONE_STEP.replace("name: one", "name: team"));
    symlinkSync(join(repo.root, "team-repo"), join(repo.root, ".konductor/workflows/team"));
    repo.ok("start", "other", "--workflow", "shared");
    expect(repo.ok("status", "other")).toStartWith("workstream other (team)");

    repo.write(".konductor/workflows/examples/deep/nested.yml", ONE_STEP.replace("name: one", "name: nested"));
    repo.ok("start", "third", "--workflow", "nested");
    expect(repo.ok("status", "third")).toStartWith("workstream third (nested)");
  });

  test("a name found twice in one workflows directory, at any depths, is refused with both paths", () => {
    const top = repo.write(".konductor/workflows/mine.yml", ONE_STEP);
    const nested = repo.write(".konductor/workflows/examples/deep/mine.yml", ONE_STEP);
    const out = repo.refused("start", "feat", "--workflow", "mine");
    expect(out).toContain('workflow name "mine" is ambiguous');
    expect(out).toContain(top);
    expect(out).toContain(nested);
  });

  test("workstreams in one repository can follow different workflows", () => {
    repo.start("one", ONE_STEP);
    repo.ok("start", "two", "--workflow", "_k-phase-chain");
    expect(repo.ok("start", "one")).toContain("STEP only");
    expect(repo.ok("start", "two")).not.toContain("STEP only");
  });
});

describe("changing the workflow of a running workstream", () => {
  test("a step added to the workflow is handed out straight away", () => {
    repo.start("feat", ONE_STEP);
    expect(repo.ok("continue", "feat")).toContain("STATUS: workflow complete");

    repo.write("workflow-source.yml", ONE_STEP + "  - id: added\n    instruction: new work\n");
    expect(repo.ok("status", "feat")).toContain("> added");
    expect(repo.ok("start", "feat")).toContain("STEP added (2 of 2)"); // and writes the new step into the state file
    expect(repo.status("feat", "added")).toBe("IN_PROGRESS");
  });
});

describe("invalid workflows are refused with the reason", () => {
  const cases: Array<[string, string, string]> = [
    ["not YAML", "version: 1\nsteps: [", "is not valid YAML"],
    ["unknown field", ONE_STEP + "    owner: me\n", "Unrecognized key"],
    ["a skill, which steps no longer name (decision 28)", ONE_STEP + "    skill: demo/SKILL.md\n", "Unrecognized key"],
    ["depends_on, replaced by consumes (decision 38)", ONE_STEP + "    depends_on: []\n", "Unrecognized key"],
    ["the gate alias, replaced by gates", ONE_STEP + "    gate: { agent: review }\n", "Unrecognized key"],
    ["duplicate step id", ONE_STEP + "  - id: only\n    instruction: again\n", 'duplicate step id "only"'],
    ["bad gate", ONE_STEP + "    gates: sometimes\n", 'must be one of owner-action, check, script or agent'],
    ["empty script", ONE_STEP + '    gates: "script:"\n', "script needs a text"],
    ["step without an instruction (decision 35)", "version: 1\nname: x\nsteps:\n  - id: a\n", "steps.0.instruction"],
    ["agent gate max_rounds below 1", ONE_STEP + "    gates: { agent: review, max_rounds: 0 }\n", "max_rounds must be a whole number, 1 or more"],
    ["max_rounds on a script gate", ONE_STEP + "    gates: { script: bun test, max_rounds: 2 }\n", "max_rounds goes on an agent gate only"],
    ["guide on an owner gate", ONE_STEP + "    gates: { owner-action: approve, guide: x.md }\n", "guide goes on an agent gate only"],
    ["route_back_to a later step", "version: 1\nname: one\nsteps:\n  - id: a\n    instruction: x\n    gates: { agent: review, route_back_to: b }\n  - id: b\n    instruction: y\n", '"a" routes back to "b", which is not this step or a step listed before it'],
    ["route_back_to a later step, at the gate that names it", "version: 1\nname: one\nsteps:\n  - id: a\n    instruction: x\n    gates: [{ script: \"true\" }, { agent: review, route_back_to: b }]\n  - id: b\n    instruction: y\n", "steps.0.gates.1.route_back_to:"],
    ["consumes an artifact no earlier step produces, at the entry", ONE_STEP + "    consumes: [spec, notes]\n", 'steps.0.consumes.1: "only" consumes "notes"'],
    ["route_back_to a bad step id", ONE_STEP + "    gates: { agent: review, route_back_to: Design }\n", "route_back_to names step ids"],
    ["a produces path without an artifact id", ONE_STEP + "    produces: [docs/x.md]\n", "steps.0.produces"],
    ["a bad artifact id", ONE_STEP + "    produces: { artifact: Spec, path: x.md }\n", "lowercase letters"],
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
  expect(out).toContain("  1. Run `true`.");
  expect(out).toContain("After 3 such rounds");
  expect(out).not.toContain("Why this step exists");
  expect(out).not.toContain("The suite must stay green");
  expect(repo.refused("start", "other", "--workflow", repo.write("bad.yml", ONE_STEP + "    gates: { script: x, description: 3 }\n"))).toContain(
    "description must be text",
  );
});

const LIBRARY_FLOW = `version: 1
name: library
steps:
  - id: write
    instruction: Write it.
    produces:
      - artifact: essay
        path: essay.md
`;

describe("finding an artifact's guide and template in the library", () => {
  test("the project's library replaces the user's, which replaces the package's; guide and template come from one folder", () => {
    const block = () => repo.ok("start", "feat").split("\n").find((l) => l.startsWith("PRODUCE"));
    repo.start("feat", LIBRARY_FLOW);
    // An artifact no library has needs no guide: the instruction is the procedure.
    expect(block()).toBe("PRODUCE essay.md (essay).");

    repo.write("home/.konductor/library/artifacts/essay/guide.md");
    repo.write("home/.konductor/library/artifacts/essay/template.md");
    expect(block()).toBe(
      "PRODUCE essay.md (essay). Follow the process in home/.konductor/library/artifacts/essay/guide.md and use the structure of home/.konductor/library/artifacts/essay/template.md.",
    );
    repo.write(".konductor/library/artifacts/essay/guide.md");
    expect(block()).toBe("PRODUCE essay.md (essay). Follow the process in .konductor/library/artifacts/essay/guide.md.");
  });

  test("a guide that is a symlink is printed where it really lives; a broken one is a missing guide (decision 11)", () => {
    repo.write("skills/essay-writing/SKILL.md");
    repo.write(".konductor/library/artifacts/essay/.keep");
    symlinkSync("../../../../skills/essay-writing/SKILL.md", join(repo.root, ".konductor/library/artifacts/essay/guide.md"));
    repo.start("feat", LIBRARY_FLOW);
    expect(repo.ok("start", "feat")).toContain("PRODUCE essay.md (essay). Follow the process in skills/essay-writing/SKILL.md.");

    repo.cleanupPath("skills/essay-writing/SKILL.md");
    const out = repo.ok("start", "feat");
    expect(out).toContain("Its guide is missing (.konductor/library/artifacts/essay/guide.md cannot be read)");
    expect(out).toContain("ask the owner whether to continue without it, install it and run this command again, or use another workflow");
  });

  test("the policy can move an artifact, and {slug} is replaced in either path", () => {
    repo.start("feat", LIBRARY_FLOW.replace("path: essay.md", "path: docs/{slug}.md"));
    expect(repo.ok("start", "feat")).toContain("PRODUCE docs/feat.md (essay).");
    repo.write(".konductor/policy-overrides.yml", "artifacts:\n  essay:\n    path: writing/{slug}/essay.md\n");
    expect(repo.ok("start", "feat")).toContain("PRODUCE writing/feat/essay.md (essay).");
  });
});

// The tracked workflows, at any depth below fuse/flow/workflows, as paths
// relative to it. personal/ and team/ are gitignored and often symlinks.
function shippedWorkflows(): string[] {
  const dir = join(FLOW_DIR, "workflows");
  const walk = (rel: string): string[] =>
    readdirSync(join(dir, rel), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return ["personal", "team", "schemas"].includes(path) ? [] : walk(path);
        return entry.name.endsWith(".yml") ? [path] : [];
      });
  return walk("");
}

describe("the workflows shipped in fuse/flow/workflows", () => {
  const shipped = shippedWorkflows();

  test("there are seven of them", () => {
    expect(shipped.sort()).toEqual([
      "_k-full-sdlc.yml",
      "_k-phase-chain.yml",
      "examples/custom-example-ambiguous.yml",
      "examples/custom-example-large.yml",
      "examples/custom-example-medium.yml",
      "examples/custom-example-small.yml",
      "examples/superpowers/superpowers.yml",
    ]);
  });

  for (const file of shipped) {
    test(`${file} is valid, starts by name, and every guide its artifacts and gates name resolves`, () => {
      repo.ok("validate", join(FLOW_DIR, "workflows", file));
      const name = basename(file, ".yml");
      // Walk every step with --forward-to, so each step block is printed once.
      const workflow = Bun.YAML.parse(readFileSync(join(FLOW_DIR, "workflows", file), "utf8")) as {
        steps: Array<{ id: string; gates?: unknown }>;
      };
      let out = repo.ok("start", "feat", "--workflow", name);
      for (const step of workflow.steps.slice(1)) {
        expect(out).not.toContain("guide is missing");
        out = repo.ok("continue", "feat", "--forward-to", step.id);
      }
      expect(out).not.toContain("guide is missing");
      // A gate's own review guide is relative to the workflow file.
      for (const step of workflow.steps) {
        const gates = (Array.isArray(step.gates) ? step.gates : step.gates ? [step.gates] : []) as Array<{ guide?: string }>;
        for (const gate of gates) {
          if (gate.guide) expect(existsSync(resolve(FLOW_DIR, "workflows", dirname(file), gate.guide))).toBe(true);
        }
      }
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

  for (const file of shippedWorkflows()) {
    test(`${file} names schemas/workflow.schema.json for WebStorm and for VS Code`, () => {
      const text = readFileSync(join(FLOW_DIR, "workflows", file), "utf8");
      const webstorm = /^# \$schema: (\S+)$/m.exec(text)?.[1];
      const vscode = /^# yaml-language-server: \$schema=(\S+)$/m.exec(text)?.[1];
      for (const path of [webstorm, vscode]) {
        expect(path).toBeDefined();
        expect(resolve(FLOW_DIR, "workflows", dirname(file), path!)).toBe(SCHEMA);
      }
    });
  }
});
