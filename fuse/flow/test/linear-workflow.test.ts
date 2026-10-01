// SPDX-License-Identifier: Apache-2.0
// An agent walks a plain linear workflow from start to finish.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FLOW_DIR, Repo } from "./helpers";

const LINEAR = `version: 1
name: linear
steps:
  - id: design
    title: Design
    skill: design/SKILL.md
    instruction: Write the design.
    produces: [docs/design.md]
  - id: build
    instruction: Build it.
    produces: [src/app.ts]
  - id: summary
    instruction: Summarize what shipped.
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("start mints a workstream that records its workflow, with every step pending, and prints the first step", () => {
  repo.write("skills/design/SKILL.md", "# design skill\n");
  const out = repo.start("feat", LINEAR);
  expect(out).toBe(
    [
      "minted workstream feat",
      `workflow: ${join(repo.root, "workflow-source.yml")}`,
      `state:    ${join(repo.root, ".konductor/workstreams/feat.yml")}`,
      "",
      "step: design (Design)",
      `read: ${join(repo.root, "skills/design/SKILL.md")}`,
      "instruction: Write the design.",
      "produce: docs/design.md",
      "gate: none",
      "then run: fuse-flow continue feat",
      "",
    ].join("\n"),
  );
  expect(repo.state("feat")).toEqual({
    workflow: join(repo.root, "workflow-source.yml"),
    steps: {
      design: { status: "pending", fix_cycles: 0, artifacts: [], history: [] },
      build: { status: "pending", fix_cycles: 0, artifacts: [], history: [] },
      summary: { status: "pending", fix_cycles: 0, artifacts: [], history: [] },
    },
  });
  // The state is private to this checkout.
  expect(repo.read(".konductor/workstreams/.gitignore")).toBe("*\n");
});

test("work, continue, repeated until the workflow is complete", () => {
  repo.start("feat", LINEAR);

  repo.write("docs/design.md");
  const first = repo.ok("continue", "feat");
  expect(first).toStartWith("recorded design: docs/design.md\ndesign done\n\nstep: build\n");
  expect(first).toContain("then run: fuse-flow continue feat");

  repo.write("src/app.ts");
  repo.write("src/app.test.ts");
  const second = repo.ok("continue", "feat", "--artifact", "src/app.test.ts");
  expect(repo.state("feat").steps.build.artifacts).toEqual(["src/app.ts", "src/app.test.ts"]);
  expect(second).toContain("produce: (nothing declared)");

  expect(repo.ok("continue", "feat")).toEndWith("summary done\n\nworkflow complete\n");
  expect(repo.refused("continue", "feat")).toContain("workflow complete; there is nothing to continue");
  expect(repo.ok("status", "feat")).toContain("workflow complete");
});

test("continue is refused while a declared artifact is missing, and each refusal costs a fix cycle", () => {
  repo.start("feat", LINEAR);
  const out = repo.refused("continue", "feat");
  expect(out).toContain("refused: missing artifact(s): docs/design.md");
  expect(out).toContain("fix cycles used on design: 1 of 2");
  expect(repo.state("feat").steps.design).toMatchObject({ status: "pending", fix_cycles: 1 });
  expect(repo.state("feat").steps.design.history[0]).toContain("continue refused: missing artifact(s): docs/design.md");

  repo.write("docs/design.md");
  expect(repo.refused("continue", "feat", "--artifact", "docs/extra.md")).toContain("missing artifact(s): docs/extra.md");
});

test("continue run twice acts on the following step, as the README says, and says so in its output", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("continue", "feat");
  // The replay meets build, whose artifact is missing: refused, and build pays the fix cycle.
  expect(repo.refused("continue", "feat")).toContain("missing artifact(s): src/app.ts");
  expect(repo.state("feat").steps.build.fix_cycles).toBe(1);
  repo.write("src/app.ts");
  repo.ok("continue", "feat");
  // The replay meets summary, which declares nothing: it is marked done, and the output names it.
  const replay = repo.ok("continue", "feat");
  expect(replay).toStartWith("recorded summary: (no artifacts)\nsummary done\n\nworkflow complete\n");
});

test("start again resumes the workstream, keeps its progress, and prints the current step", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("continue", "feat");
  const out = repo.ok("start", "feat");
  expect(out).toContain("resumed workstream feat");
  expect(out).toContain("step: build");
  expect(repo.status("feat", "design")).toBe("done");
});

test("status lists every step and marks the current one", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("continue", "feat");
  expect(repo.ok("status", "feat")).toBe(
    [
      "workstream feat (linear)",
      "  design   done            gate none    docs/design.md",
      "> build    pending         gate none",
      "  summary  pending         gate none",
      "current step: build; fuse-flow start feat prints what to do",
      "",
    ].join("\n"),
  );
});

test("the fuse-flow script works from any directory, and prints follow-up commands that work without PATH", () => {
  repo.start("feat", LINEAR);
  const nested = join(repo.root, "src", "deep");
  mkdirSync(nested, { recursive: true });
  const script = join(FLOW_DIR, "fuse-flow");
  expect(repo.env.PATH.split(":")).not.toContain(FLOW_DIR);

  const r = repo.run(["start", "feat"], nested, [script]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("step: design");
  expect(existsSync(join(nested, ".konductor"))).toBe(false);

  // Run the printed follow-up command exactly as written.
  const printed = r.out.split("\n").find((line) => line.startsWith("then run: "))!.slice("then run: ".length);
  expect(printed).toBe(`${script} continue feat`);
  repo.write("docs/design.md");
  const [command, ...args] = printed.split(" ");
  const followUp = repo.run(args, nested, [command]);
  expect(followUp.code).toBe(0);
  expect(followUp.out).toContain("step: build");
  expect(followUp.out).toContain(`then run: ${script} continue feat`);
});

test("a script path with spaces and quotes is quoted in the printed commands", () => {
  // A launcher in an awkward directory, standing in for a checkout there.
  const launcher = repo.write(`my dir/it's/fuse-flow`, `#!/bin/sh\nexec "${process.execPath}" run "${join(FLOW_DIR, "src", "cli.ts")}" "$@"\n`);
  chmodSync(launcher, 0o755);
  repo.env.FUSE_FLOW_COMMAND = launcher;

  const printed = repo.start("feat", LINEAR).split("\n").find((line) => line.startsWith("then run: "))!.slice("then run: ".length);
  expect(printed).toBe(`'${launcher.replace("'", `'\\''`)}' continue feat`);
  repo.write("docs/design.md");
  const followUp = repo.run(["-c", printed], repo.root, ["sh"]);
  expect(followUp.code).toBe(0);
  expect(followUp.out).toContain("design done");
});

test("a step id that is also a JavaScript object property works like any other", () => {
  expect(repo.start("feat", "version: 1\nname: odd\nsteps:\n  - id: constructor\n    instruction: x\n")).toContain("step: constructor");
  expect(repo.ok("continue", "feat")).toEndWith("workflow complete\n");
});

test("workstreams in one repository are independent", () => {
  repo.start("one", LINEAR);
  repo.ok("start", "two", "--workflow", join(repo.root, "workflow-source.yml"));
  repo.write("docs/design.md");
  repo.ok("continue", "one");
  expect(repo.ok("start", "one")).toContain("step: build");
  expect(repo.ok("start", "two")).toContain("step: design");
});

test("a fresh copy of fuse-flow installs its own dependencies on first use, with Bun and with Node", () => {
  // A clone that was never set up: the sources without node_modules.
  const copy = join(repo.root, "clone", "fuse", "flow");
  mkdirSync(copy, { recursive: true });
  for (const entry of ["fuse-flow", "package.json", "bun.lock", "tsconfig.json", "src", "workflows"]) {
    cpSync(join(FLOW_DIR, entry), join(copy, entry), { recursive: true });
  }
  const script = join(copy, "fuse-flow");
  const workflow = repo.write("workflow-source.yml", LINEAR);

  expect(existsSync(join(copy, "node_modules"))).toBe(false);
  const withBun = repo.run(["start", "feat", "--workflow", workflow], repo.root, [script]);
  expect(withBun.code).toBe(0);
  expect(withBun.out).toContain(`installing dependencies in ${copy}`);
  expect(withBun.out).toContain("step: design");
  expect(existsSync(join(copy, "node_modules", "zod"))).toBe(true);

  // The second run finds them and says nothing about it.
  const again = repo.run(["status", "feat"], repo.root, [script]);
  expect(again.code).toBe(0);
  expect(again.out).not.toContain("installing dependencies");

  // An interrupted install leaves a package directory empty or missing: installed again.
  rmSync(join(copy, "node_modules", "yaml", "package.json"));
  const repaired = repo.run(["status", "feat"], repo.root, [script]);
  expect(repaired.code).toBe(0);
  expect(repaired.out).toContain("installing dependencies");
  expect(existsSync(join(copy, "node_modules", "yaml", "package.json"))).toBe(true);

  // Without Bun on PATH the shim falls back to Node, which installs with npm.
  const nodePath = pathWithNodeOnly();
  if (!nodePath) return;
  rmSync(join(copy, "node_modules"), { recursive: true });
  const env = { ...repo.env, PATH: nodePath, BUN_INSTALL: join(repo.root, "no-bun") };
  const withNode = Bun.spawnSync([script, "status", "feat"], { cwd: repo.root, env, stdout: "pipe", stderr: "pipe" });
  const out = withNode.stdout.toString() + withNode.stderr.toString();
  expect(out).toContain(`installing dependencies in ${copy}`);
  expect(out).toContain("current step: design");
  expect(withNode.exitCode).toBe(0);
});

// A PATH holding Node 22.18+ with its npm, and no Bun; undefined when this
// machine has no such Node. FUSE_FLOW_TEST_NODE_BIN names the bin directory
// when it is not on PATH (for example a version manager's install).
function pathWithNodeOnly(): string | undefined {
  const dirs = [process.env.FUSE_FLOW_TEST_NODE_BIN, ...(process.env.PATH ?? "").split(":")].filter((d): d is string => !!d);
  for (const dir of dirs) {
    if (!existsSync(join(dir, "node")) || !existsSync(join(dir, "npm"))) continue;
    const version = Bun.spawnSync([join(dir, "node"), "--version"]).stdout.toString().trim();
    const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
    if (!(major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18))) continue;
    const path = `${dir}:/usr/bin:/bin`;
    if (!Bun.which("bun", { PATH: path })) return path;
  }
  return undefined;
}
