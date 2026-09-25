// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Repo } from "./helpers";

const CHECKED = `version: 1
name: checked
max_fix_cycles: 2
steps:
  - id: build
    instruction: build it
    produces: [out/report.md]
    gate: "check: test -f out/build.ok"
  - id: ship
    instruction: ship it
    produces: [out/ship.md]
    gate: "check: exit 3"
`;

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
  repo.ok(["start", "rel", "--workflow", repo.workflow(CHECKED)]);
});
afterEach(() => repo.cleanup());

describe("done", () => {
  test("refuses when a declared artifact is missing and counts a fix cycle", () => {
    const out = repo.fail(["done", "rel", "build"]);
    expect(out).toContain("missing artifact(s): out/report.md");
    expect(out).toContain("fix cycles used on build: 1");
    const st = repo.state("rel").steps.build;
    expect(st.status).toBe("pending");
    expect(st.fix_cycles).toBe(1);
    expect(st.notes[0]).toContain("done refused");
  });

  test("refuses when an --artifact path does not exist", () => {
    repo.write("out/report.md");
    const out = repo.fail(["done", "rel", "build", "--artifact", "out/extra.md"]);
    expect(out).toContain("missing artifact(s): out/extra.md");
  });

  test("refuses when the check command fails, with its output", () => {
    repo.write("out/report.md");
    const out = repo.fail(["done", "rel", "build"]);
    expect(out).toContain("check failed (exit 1): test -f out/build.ok");
    expect(repo.state("rel").steps.build.status).toBe("pending");
    expect(repo.state("rel").steps.build.fix_cycles).toBe(1);
  });

  test("records and advances when artifacts exist and the check passes", () => {
    repo.write("out/report.md");
    repo.write("out/build.ok");
    const out = repo.ok(["done", "rel", "build", "--artifact", "out/build.ok"]);
    expect(out).toContain("build done");
    const st = repo.state("rel").steps.build;
    expect(st.status).toBe("done");
    expect(st.artifacts).toEqual(["out/report.md", "out/build.ok"]);
    expect(st.gate.outcome).toBe("check-passed");
    expect(repo.ok(["next", "rel"])).toContain("step: ship");
  });

  test("blocks the step once max_fix_cycles failed attempts are used", () => {
    repo.write("out/report.md");
    repo.write("out/build.ok");
    repo.ok(["done", "rel", "build"]);
    repo.write("out/ship.md");
    expect(repo.fail(["done", "rel", "ship"])).toContain("fix cycles used on ship: 1");
    const second = repo.fail(["done", "rel", "ship"]);
    expect(second).toContain("fix cycles used on ship: 2 (step is now blocked)");
    expect(repo.state("rel").steps.ship.status).toBe("blocked");
    const third = repo.fail(["done", "rel", "ship"]);
    expect(third).toContain("is blocked after 2 failed attempts");
    expect(repo.state("rel").steps.ship.fix_cycles).toBe(2);
    const nxt = repo.ok(["next", "rel"]);
    expect(nxt).toContain("step: ship is blocked after 2 failed attempts");
    expect(nxt).toContain("fuse-flow gate rel ship --owner-approved");
  });

  test("refuses to redo a done step without counting a fix cycle", () => {
    repo.write("out/report.md");
    repo.write("out/build.ok");
    repo.ok(["done", "rel", "build"]);
    expect(repo.fail(["done", "rel", "build"])).toContain("already done");
    expect(repo.state("rel").steps.build.fix_cycles).toBe(0);
  });

  test("an unknown step names the known ones", () => {
    expect(repo.fail(["done", "rel", "nope"])).toContain("steps are: build, ship");
  });

  test("the check runs from the repository root with step context in env", () => {
    const wf = `version: 1
name: env
steps:
  - id: only
    instruction: x
    gate: "check: test \\"$FUSE_FLOW_STEP\\" = only && test \\"$PWD\\" = \\"$(pwd -P)\\" && test -f wf.yml"
`;
    const r = new Repo();
    try {
      r.ok(["start", "e", "--workflow", r.workflow(wf)]);
      expect(r.ok(["done", "e", "only"])).toContain("only done");
    } finally {
      r.cleanup();
    }
  });
});
