// SPDX-License-Identifier: Apache-2.0
// An agent walks a plain linear workflow from start to finish.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
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

test("start mints a workstream that records its workflow, with every step pending", () => {
  const out = repo.start("feat", LINEAR);
  expect(out).toContain("minted workstream feat");
  expect(out).toContain("next: fuse-flow next feat");
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

test("next, work, done, repeated until the workflow is complete", () => {
  repo.write("skills/design/SKILL.md", "# design skill\n");
  repo.start("feat", LINEAR);

  expect(repo.ok("next", "feat")).toBe(
    [
      "step: design (Design)",
      `read: ${join(repo.root, "skills/design/SKILL.md")}`,
      "instruction: Write the design.",
      "produce: docs/design.md",
      "gate: none",
      "then run: fuse-flow done feat design",
      "",
    ].join("\n"),
  );
  repo.write("docs/design.md");
  // done prints what next would print, so the agent needs no extra call.
  const doneOut = repo.ok("done", "feat", "design");
  expect(doneOut).toStartWith("recorded design: docs/design.md\ndesign done\n\nstep: build\n");
  expect(doneOut).toContain("then run: fuse-flow done feat build");

  expect(repo.ok("next", "feat")).toContain("step: build");
  repo.write("src/app.ts");
  repo.write("src/app.test.ts");
  repo.ok("done", "feat", "build", "--artifact", "src/app.test.ts");
  expect(repo.state("feat").steps.build.artifacts).toEqual(["src/app.ts", "src/app.test.ts"]);

  expect(repo.ok("next", "feat")).toContain("produce: (nothing declared)");
  expect(repo.ok("done", "feat", "summary")).toEndWith("summary done\n\nworkflow complete\n");

  expect(repo.ok("next", "feat")).toBe("workflow complete\n");
  expect(repo.ok("status", "feat")).toContain("workflow complete");
});

test("done is refused while a declared artifact is missing, and each refusal costs a fix cycle", () => {
  repo.start("feat", LINEAR);
  const out = repo.refused("done", "feat", "design");
  expect(out).toContain("refused: missing artifact(s): docs/design.md");
  expect(out).toContain("fix cycles used on design: 1 of 2");
  expect(repo.state("feat").steps.design).toMatchObject({ status: "pending", fix_cycles: 1 });
  expect(repo.state("feat").steps.design.history[0]).toContain("done refused: missing artifact(s): docs/design.md");

  repo.write("docs/design.md");
  expect(repo.refused("done", "feat", "design", "--artifact", "docs/extra.md")).toContain("missing artifact(s): docs/extra.md");
});

test("a step cannot be done twice or out of order, and that costs no fix cycle", () => {
  repo.start("feat", LINEAR);
  expect(repo.refused("done", "feat", "build")).toContain('step "build" waits on: design');
  repo.write("docs/design.md");
  repo.ok("done", "feat", "design");
  expect(repo.refused("done", "feat", "design")).toContain('step "design" is done, not pending');
  expect(repo.state("feat").steps.build.fix_cycles).toBe(0);
  expect(repo.state("feat").steps.design.fix_cycles).toBe(0);
});

test("done on an unknown step lists the workflow's steps", () => {
  repo.start("feat", LINEAR);
  expect(repo.refused("done", "feat", "deploy")).toContain('unknown step "deploy"; the steps are: design, build, summary');
});

test("start again resumes the workstream and keeps its progress", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("done", "feat", "design");
  expect(repo.ok("start", "feat")).toContain("resumed workstream feat");
  expect(repo.status("feat", "design")).toBe("done");
});

test("status lists every step", () => {
  repo.start("feat", LINEAR);
  repo.write("docs/design.md");
  repo.ok("done", "feat", "design");
  expect(repo.ok("status", "feat")).toBe(
    [
      "workstream feat (linear)",
      "  design   done            gate none    docs/design.md",
      "  build    pending         gate none",
      "  summary  pending         gate none    waits on build",
      "next: fuse-flow next feat",
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

  const r = repo.run(["next", "feat"], nested, [script]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("step: design");
  expect(existsSync(join(nested, ".konductor"))).toBe(false);

  // Run the printed follow-up command exactly as written.
  const printed = r.out.split("\n").find((line) => line.startsWith("then run: "))!.slice("then run: ".length);
  expect(printed).toBe(`${script} done feat design`);
  repo.write("docs/design.md");
  const [command, ...args] = printed.split(" ");
  const followUp = repo.run(args, nested, [command]);
  expect(followUp.code).toBe(0);
  expect(followUp.out).toContain(`then run: ${script} done feat build`);
});

test("a script path with spaces and quotes is quoted in the printed commands", () => {
  repo.start("feat", LINEAR);
  // A launcher in an awkward directory, standing in for a checkout there.
  const launcher = repo.write(`my dir/it's/fuse-flow`, `#!/bin/sh\nexec "${process.execPath}" run "${join(FLOW_DIR, "src", "cli.ts")}" "$@"\n`);
  chmodSync(launcher, 0o755);
  repo.env.FUSE_FLOW_COMMAND = launcher;

  const printed = repo.ok("next", "feat").split("\n").find((line) => line.startsWith("then run: "))!.slice("then run: ".length);
  expect(printed).toBe(`'${launcher.replace("'", `'\\''`)}' done feat design`);
  repo.write("docs/design.md");
  const followUp = repo.run(["-c", printed], repo.root, ["sh"]);
  expect(followUp.code).toBe(0);
  expect(followUp.out).toContain("design done");
});

test("a step id that is also a JavaScript object property works like any other", () => {
  repo.start("feat", "version: 1\nname: odd\nsteps:\n  - id: constructor\n    instruction: x\n");
  expect(repo.ok("next", "feat")).toContain("step: constructor");
  repo.ok("done", "feat", "constructor");
  expect(repo.ok("next", "feat")).toBe("workflow complete\n");
});

test("workstreams in one repository are independent", () => {
  repo.start("one", LINEAR);
  repo.ok("start", "two", "--workflow", join(repo.root, "workflow-source.yml"));
  repo.write("docs/design.md");
  repo.ok("done", "one", "design");
  expect(repo.ok("next", "one")).toContain("step: build");
  expect(repo.ok("next", "two")).toContain("step: design");
});
