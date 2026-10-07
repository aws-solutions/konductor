// SPDX-License-Identifier: Apache-2.0
// An agent lists what it can pick up or start: the project's workstreams and
// every workflow, with its description and the name that starts it.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FLOW_DIR, Repo } from "./helpers";

const flow = (name: string, description?: string) =>
  `version: 1\nname: ${name}\n${description ? `description: >\n  ${description}\n` : ""}steps:\n  - id: one\n    instruction: Do it.\n  - id: two\n    instruction: Then this.\n`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("with nothing started, list says so and shows the shipped workflows with their descriptions", () => {
  const out = repo.ok("list");
  expect(out).toStartWith("WORKSTREAMS in this project: none\n");
  expect(out).toContain(`this project, ${join(repo.root, ".konductor/workflows")}: none\n`);
  expect(out).toContain(`yours, ${join(repo.root, "home/.konductor/workflows")}: none\n`);
  expect(out).toContain(`shipped with fuse-flow, ${join(FLOW_DIR, "workflows")}:\n`);
  expect(out).toContain("  fuse-feature-development (fuse-development/fuse-feature-development.yml)\n      One feature in an existing codebase:");
});

test("list shows each workstream with its workflow and current step, and a complete one as complete", () => {
  repo.write(".konductor/workflows/small.yml", flow("small", "A small change."));
  repo.ok("start", "first", "--workflow", "small");
  repo.ok("start", "second", "--workflow", "small");
  repo.ok("continue", "second");
  repo.ok("continue", "second");

  const out = repo.ok("list");
  expect(out).toContain("WORKSTREAMS in this project; `fuse-flow start <slug>` resumes one:\n");
  expect(out).toMatch(/\n {2}first \(small, started \d{4}-\d{2}-\d{2}\): step one, 1 of 2, IN_PROGRESS\n/);
  expect(out).toMatch(/\n {2}second \(small, started \d{4}-\d{2}-\d{2}\): workflow complete\n/);
});

test("a name in an earlier location wins, and the later one is listed with how to start it", () => {
  repo.write(".konductor/workflows/team/fuse-feature-development.yml", flow("fuse-feature-development", "Our own feature flow."));
  const out = repo.ok("list");
  expect(out).toContain("  fuse-feature-development (team/fuse-feature-development.yml)\n      Our own feature flow.\n");
  expect(out).toContain(
    "  fuse-feature-development (fuse-development/fuse-feature-development.yml) (start it by its path; the name starts the one in this project)\n",
  );
});

test("an invalid file, an ambiguous name and a .yaml file are listed with what to do, without hiding the others", () => {
  repo.write("home/.konductor/workflows/broken.yml", "version: 1\nname: broken\n");
  repo.write("home/.konductor/workflows/a/twice.yml", flow("twice"));
  repo.write("home/.konductor/workflows/b/twice.yml", flow("twice"));
  repo.write("home/.konductor/workflows/other.yaml", flow("other", "Spelled .yaml."));
  repo.write("home/.konductor/workflows/fine.yml", flow("fine", "Works."));

  const out = repo.ok("list");
  expect(out).toContain("  broken.yml: not a valid workflow; `fuse-flow validate ");
  expect(out).toContain("  twice (a/twice.yml) (ambiguous in this location; start it by its path, or rename one)\n");
  expect(out).toContain("  twice (b/twice.yml) (ambiguous in this location; start it by its path, or rename one)\n");
  expect(out).toContain("  other.yaml (other.yaml) (start it by its path; only .yml files are found by name)\n      Spelled .yaml.\n");
  expect(out).toContain("  fine (fine.yml)\n      Works.\n");
});

test("an unreadable workstream file is listed with the reason, and the rest still are", () => {
  repo.write(".konductor/workflows/small.yml", flow("small"));
  repo.ok("start", "good", "--workflow", "small");
  repo.write(".konductor/workstreams/bad.yml", "not: a workstream\n");
  const out = repo.ok("list");
  expect(out).toContain("  bad: cannot be read: ");
  expect(out).toContain("  good (small, started ");
});

test("list takes no arguments", () => {
  expect(repo.usage("list", "extra")).toContain("error: list takes no arguments");
});

test("a name that resolves to an invalid or ambiguous earlier file blocks the later one by name, as start does", () => {
  repo.write(".konductor/workflows/fuse-feature-development.yml", "version: 1\nname: fuse-feature-development\n");
  repo.write("home/.konductor/workflows/a/fuse-system-development.yml", flow("fuse-system-development"));
  repo.write("home/.konductor/workflows/b/fuse-system-development.yml", flow("fuse-system-development"));

  const out = repo.ok("list");
  expect(out).toContain(
    "  fuse-feature-development (fuse-development/fuse-feature-development.yml) (start it by its path; the name starts the one in this project)\n",
  );
  expect(out).toContain(
    "  fuse-system-development (fuse-development/fuse-system-development.yml) (start it by its path; the name is ambiguous in yours)\n",
  );
  // And start agrees: the name reaches the invalid file, or is refused as ambiguous.
  expect(repo.refused("start", "one", "--workflow", "fuse-feature-development")).toContain("is not a valid workflow");
  expect(repo.refused("start", "two", "--workflow", "fuse-system-development")).toContain("is ambiguous");
});
