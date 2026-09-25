// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ABC, PHASE_CHAIN_WORKFLOW, Repo, SDLC_WORKFLOW } from "./helpers";

let repo: Repo;
beforeEach(() => {
  repo = new Repo();
});
afterEach(() => repo.cleanup());

describe("start", () => {
  test("mints a workstream and copies the workflow into .konductor", () => {
    const wf = repo.workflow(ABC);
    const out = repo.ok(["start", "feat", "--workflow", wf]);
    expect(out).toContain("minted workstream feat");
    expect(existsSync(join(repo.root, ".konductor", "workflow.yml"))).toBe(true);
    const st = repo.state("feat");
    expect(st.slug).toBe("feat");
    expect(st.project.root).toBe(repo.root);
    expect(Object.keys(st.steps)).toEqual(["a", "b", "c"]);
    expect(st.steps.a.status).toBe("pending");
  });

  test("resumes the same workstream by repo root plus slug", () => {
    repo.ok(["start", "feat", "--workflow", repo.workflow(ABC)]);
    repo.write("out/a.md");
    repo.ok(["done", "feat", "a"]);
    const out = repo.ok(["start", "feat"]);
    expect(out).toContain("resumed workstream feat");
    expect(repo.state("feat").steps.a.status).toBe("done");
  });

  test("refuses a state file minted for another repository", () => {
    const other = new Repo();
    try {
      other.ok(["start", "feat", "--workflow", other.workflow(ABC)]);
      repo.workflow(ABC);
      mkdirSync(join(repo.root, ".konductor", "workstreams"), { recursive: true });
      writeFileSync(join(repo.root, ".konductor", "workflow.yml"), ABC);
      writeFileSync(repo.statePath("feat"), readFileSync(other.statePath("feat")));
      const out = repo.fail(["start", "feat"]);
      expect(out).toContain("was minted for");
    } finally {
      other.cleanup();
    }
  });

  test("resume picks up steps added to the workflow", () => {
    repo.ok(["start", "feat", "--workflow", repo.workflow(ABC)]);
    writeFileSync(join(repo.root, ".konductor", "workflow.yml"), ABC + "  - id: d\n    instruction: do d\n");
    const out = repo.ok(["start", "feat"]);
    expect(out).toContain("steps added from the workflow: d");
    expect(repo.state("feat").steps.d.status).toBe("pending");
  });

  test("needs a workflow file the first time", () => {
    const out = repo.fail(["start", "feat"]);
    expect(out).toContain("--workflow");
  });

  test("refuses to overwrite a different existing workflow.yml", () => {
    repo.ok(["start", "feat", "--workflow", repo.workflow(ABC)]);
    const other = repo.write("other.yml", ABC.replace("name: abc", "name: xyz"));
    const out = repo.fail(["start", "feat", "--workflow", other]);
    expect(out).toContain("differs from");
  });

  test("the shipped _k-full-sdlc.yml validates and starts", () => {
    const out = repo.ok(["start", "proj", "--workflow", SDLC_WORKFLOW]);
    expect(out).toContain("minted workstream proj");
    const st = repo.state("proj");
    expect(Object.keys(st.steps)[0]).toBe("elicitation");
    expect(Object.keys(st.steps).at(-1)).toBe("final-summary");
    expect(Object.keys(st.steps)).toHaveLength(12);
  });

  test("the shipped _k-phase-chain.yml validates and starts", () => {
    const out = repo.ok(["start", "proj", "--workflow", PHASE_CHAIN_WORKFLOW]);
    expect(out).toContain("minted workstream proj");
    const st = repo.state("proj");
    expect(Object.keys(st.steps)).toEqual([
      "pm", "architect", "feature-splitting", "specs", "implementation", "code-review", "qa",
    ]);
  });

  test("rejects a bad slug with a usage error", () => {
    const out = repo.fail(["start", "Bad_Slug", "--workflow", repo.workflow(ABC)], 64);
    expect(out).toContain("slug");
  });
});
