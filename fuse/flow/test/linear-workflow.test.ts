// SPDX-License-Identifier: Apache-2.0
// An agent walks a plain linear workflow from start to finish.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLOW_DIR, Repo } from "./helpers";

const LINEAR = `version: 1
name: linear
steps:
  - id: design
    title: Design
    instruction: Write the design.
    produces:
      - artifact: sketch
        path: docs/design.md
  - id: build
    instruction: Build it.
    produces:
      artifact: app
      path: src/app.ts
  - id: summary
    instruction: Summarize what shipped.
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("start mints a workstream that records its workflow, hands out the first step, and prints its step block", () => {
  const out = repo.start("feat", LINEAR);
  expect(out).toBe(
    [
      "minted workstream feat",
      `workflow: ${join(repo.root, "workflow-source.yml")}`,
      `state:    ${join(repo.root, ".konductor/workstreams/feat.yml")}`,
      "",
      "STEP design (1 of 3): Write the design.",
      "PRODUCE docs/design.md (sketch).",
      "WHEN THE WORK IS DONE:",
      '  1. Run `fuse-flow continue feat`, with --not-produced sketch "<reason>" only if you rightly did not write sketch.',
      "",
    ].join("\n"),
  );
  const state = repo.state("feat");
  expect(state.workflow).toBe(join(repo.root, "workflow-source.yml"));
  expect(state.steps.design.status).toBe("IN_PROGRESS");
  expect(state.steps.design.history[0]).toEndWith(" handed out");
  expect(state.steps.build).toEqual({ status: "PENDING", artifacts: [], history: [] });
  expect(state.steps.summary).toEqual({ status: "PENDING", artifacts: [], history: [] });
  // The state is private to this checkout.
  expect(repo.read(".konductor/workstreams/.gitignore")).toBe("*\n");
});

test("work, continue, repeated until the workflow is complete, which prints the hand-over block", () => {
  repo.start("feat", LINEAR);

  repo.write("docs/design.md");
  const first = repo.ok("continue", "feat");
  expect(first).toStartWith("design: COMPLETED\n\nSTEP build (2 of 3): Build it.\nPRODUCE src/app.ts (app).\n");
  // A step without an owner gate approves its artifacts when it completes (decision 46).
  expect(repo.state("feat").steps.design.artifacts).toEqual([{ artifact: "sketch", path: "docs/design.md", status: "approved" }]);

  repo.write("src/app.ts");
  repo.write("src/app.test.ts");
  const second = repo.ok("continue", "feat", "--updated", "src/app.test.ts");
  expect(repo.state("feat").steps.build.updated).toEqual(["src/app.test.ts"]);
  expect(second).toContain("STEP summary (3 of 3): Summarize what shipped.\nWHEN THE WORK IS DONE:\n  1. Run `fuse-flow continue feat`.\n");

  const done = repo.ok("continue", "feat");
  expect(done).toStartWith("summary: COMPLETED\n\nOWNER'S TURN:");
  expect(done).toContain("SUMMARY: <the work, in a sentence>. Workstream feat, all 3 steps of linear.\n");
  expect(done).toContain("STATUS: workflow complete\n");
  expect(done).toContain("PRODUCED: design: docs/design.md (new); build: src/app.ts (new); src/app.test.ts (updated, outside the declared paths)\n");
  expect(repo.refused("continue", "feat")).toContain("REFUSED: workflow complete; there is nothing to continue");
  expect(repo.ok("status", "feat")).toContain("workflow complete");
});

test("continue is refused while a produces artifact is missing, repeats the step block, and never blocks the step", () => {
  repo.start("feat", LINEAR);
  const out = repo.refused("continue", "feat");
  expect(out).toStartWith(
    "REFUSED: missing artifact(s): docs/design.md (sketch). Write each, or report one the step rightly does not produce " +
      'with --not-produced <artifact> "<reason>".\n\nSTEP design (1 of 3): Write the design.\n',
  );
  expect(repo.state("feat").steps.design.history.at(-1)).toContain("continue refused: missing artifact(s): docs/design.md");
  for (let i = 0; i < 3; i++) repo.refused("continue", "feat");
  expect(repo.status("feat", "design")).toBe("IN_PROGRESS");
});

test("an artifact the step rightly does not produce is reported with its reason instead (decision 45)", () => {
  repo.start("feat", LINEAR);
  expect(repo.usage("continue", "feat", "--not-produced", "sketch")).toContain("--not-produced takes an artifact and a reason");
  expect(repo.refused("continue", "feat", "--not-produced", "app", "x")).toContain(
    '--not-produced names an artifact the step produces, by its id or its path; "app" is neither (sketch (docs/design.md))',
  );
  const out = repo.ok("continue", "feat", "--not-produced", "sketch", "a one-line fix needs no design");
  expect(out).toStartWith("design: COMPLETED\n");
  const state = repo.state("feat").steps.design;
  expect(state.not_produced).toEqual({ sketch: "a one-line fix needs no design" });
  expect(state.artifacts).toEqual([]);
});

test("continue run twice acts on the following step, and says so in its output", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("continue", "feat");
  // The replay meets build, whose artifact is missing: refused, and recorded in build's history.
  expect(repo.refused("continue", "feat")).toContain("missing artifact(s): src/app.ts");
  repo.write("src/app.ts");
  repo.ok("continue", "feat");
  // The replay meets summary, which declares nothing: it completes, and the output names it.
  expect(repo.ok("continue", "feat")).toStartWith("summary: COMPLETED\n");
});

test("start again resumes the workstream, keeps its progress, and prints the current step", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("continue", "feat");
  const out = repo.ok("start", "feat");
  expect(out).toContain("resumed workstream feat");
  expect(out).toContain("STEP build (2 of 3)");
  expect(repo.status("feat", "design")).toBe("COMPLETED");
});

test("status lists every step and marks the current one", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("continue", "feat");
  expect(repo.ok("status", "feat")).toBe(
    [
      "workstream feat (linear)",
      "  design   COMPLETED       gates none    docs/design.md (approved)",
      "> build    IN_PROGRESS     gates none",
      "  summary  PENDING         gates none",
      "current step: build; fuse-flow start feat prints what to do",
      "",
    ].join("\n"),
  );
});

test("a state file written before the six step states is read and migrated (decision 40)", () => {
  repo.start("feat", LINEAR);
  repo.write(
    ".konductor/workstreams/feat.yml",
    `workflow: ${join(repo.root, "workflow-source.yml")}
steps:
  design:
    status: done
    fix_cycles: 2
    artifacts: [docs/design.md]
    history: []
  build:
    status: pending
    artifacts: []
    history: []
`,
  );
  expect(repo.ok("start", "feat")).toContain("STEP build (2 of 3)");
  const state = repo.state("feat");
  expect(state.steps.design).toEqual({ status: "COMPLETED", artifacts: [{ path: "docs/design.md", status: "approved" }], history: [] });
  expect(state.steps.build.status).toBe("IN_PROGRESS");
});

test("the fuse-flow script works from any directory, and prints follow-up commands that work without PATH", () => {
  repo.start("feat", LINEAR);
  const nested = join(repo.root, "src", "deep");
  mkdirSync(nested, { recursive: true });
  const script = join(FLOW_DIR, "fuse-flow");
  expect(repo.env.PATH.split(":")).not.toContain(FLOW_DIR);

  const r = repo.run(["start", "feat"], nested, [script]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("STEP design (1 of 3)");
  expect(existsSync(join(nested, ".konductor"))).toBe(false);

  // Run the printed follow-up command exactly as written.
  const printed = /Run `([^`]+)`/.exec(r.out)![1];
  expect(printed).toBe(`${script} continue feat`);
  repo.write("docs/design.md");
  const [command, ...args] = printed.split(" ");
  const followUp = repo.run(args, nested, [command]);
  expect(followUp.code).toBe(0);
  expect(followUp.out).toContain("STEP build (2 of 3)");
  expect(followUp.out).toContain(`Run \`${script} continue feat\``);
});

test("a script path with spaces and quotes is quoted in the printed commands", () => {
  // A launcher in an awkward directory, standing in for a checkout there.
  const launcher = repo.write(`my dir/it's/fuse-flow`, `#!/bin/sh\nexec "${process.execPath}" run "${join(FLOW_DIR, "src", "cli.ts")}" "$@"\n`);
  chmodSync(launcher, 0o755);
  repo.env.FUSE_FLOW_COMMAND = launcher;

  const printed = /Run `([^`]+)`/.exec(repo.start("feat", LINEAR))![1];
  expect(printed).toBe(`'${launcher.replace("'", `'\\''`)}' continue feat`);
  repo.write("docs/design.md");
  const followUp = repo.run(["-c", printed], repo.root, ["sh"]);
  expect(followUp.code).toBe(0);
  expect(followUp.out).toContain("design: COMPLETED");
});

test("a step id that is also a JavaScript object property works like any other", () => {
  expect(repo.start("feat", "version: 1\nname: odd\nsteps:\n  - id: constructor\n    instruction: x\n")).toContain("STEP constructor (1 of 1)");
  expect(repo.ok("continue", "feat")).toContain("STATUS: workflow complete");
});

test("workstreams in one repository are independent", () => {
  repo.start("one", LINEAR);
  repo.ok("start", "two", "--workflow", join(repo.root, "workflow-source.yml"));
  repo.write("docs/design.md");
  repo.ok("continue", "one");
  expect(repo.ok("start", "one")).toContain("STEP build");
  expect(repo.ok("start", "two")).toContain("STEP design");
});

test("a fresh copy of fuse-flow installs its own dependencies on first use, with Bun and with Node", () => {
  // A clone that was never set up: the sources without node_modules.
  const copy = join(repo.root, "clone", "fuse", "flow");
  mkdirSync(copy, { recursive: true });
  for (const entry of ["fuse-flow", "package.json", "bun.lock", "tsconfig.json", "src", "workflows", "library"]) {
    if (!existsSync(join(FLOW_DIR, entry))) continue;
    cpSync(join(FLOW_DIR, entry), join(copy, entry), { recursive: true });
  }
  const script = join(copy, "fuse-flow");
  const workflow = repo.write("workflow-source.yml", LINEAR);

  expect(existsSync(join(copy, "node_modules"))).toBe(false);
  const withBun = repo.run(["start", "feat", "--workflow", workflow], repo.root, [script]);
  expect(withBun.code).toBe(0);
  expect(withBun.out).toContain(`installing dependencies in ${copy}`);
  expect(withBun.out).toContain("STEP design");
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
}, 60_000);

// A PATH holding Node 22.18+ with its npm, and no Bun; undefined when this
// machine has no such Node. FUSE_FLOW_TEST_NODE_BIN names the bin directory
// when it is not on PATH. A version manager's shim (mise, asdf, volta) is
// resolved to the directory of the real binary: the test runs fuse-flow with a
// private HOME, where a shim finds no installed Node and would download one.
function pathWithNodeOnly(): string | undefined {
  const candidates = [process.env.FUSE_FLOW_TEST_NODE_BIN, ...(process.env.PATH ?? "").split(":")].filter((d): d is string => !!d);
  for (const candidate of candidates) {
    if (!existsSync(join(candidate, "node"))) continue;
    const real = Bun.spawnSync([join(candidate, "node"), "-p", "process.execPath"]).stdout.toString().trim();
    if (!real) continue;
    const dir = dirname(real);
    if (!existsSync(join(dir, "npm"))) continue;
    const version = Bun.spawnSync([join(dir, "node"), "--version"]).stdout.toString().trim();
    const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
    if (!(major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18))) continue;
    const path = `${dir}:/usr/bin:/bin`;
    if (!Bun.which("bun", { PATH: path })) return path;
  }
  return undefined;
}
