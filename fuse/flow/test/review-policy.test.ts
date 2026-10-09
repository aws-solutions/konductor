// SPDX-License-Identifier: Apache-2.0
// Who reviews and how the reviewer is started come from the policy files, as
// do the owner's rulings where fuse-flow and other installed rules overlap.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Repo } from "./helpers";

const FLOW = `version: 1
name: reviewed
steps:
  - id: build
    instruction: Build it.
    updates:
      - artifact: patch
        path: src/
    gates:
      - agent: review the diff against the spec
`;

let repo: Repo;
beforeEach(() => (repo = new Repo()));
afterEach(() => repo.cleanup());

test("the reviewer table merges across the policy files, the more specific file winning per author model", () => {
  expect(repo.start("feat", FLOW)).not.toContain("Pick the reviewer's model");

  repo.write(
    "home/.konductor/policy-overrides.yml",
    "review:\n  reviewers:\n    claude-opus-5.5: { model: gpt-6.1-sol, effort: high }\n    gpt-6.1-sol: { model: claude-opus-5.5, effort: high }\n",
  );
  repo.write(".konductor/policy-overrides.local.yml", "review:\n  reviewers:\n    gpt-6.1-sol: { model: claude-opus-5.6 }\n");
  expect(repo.ok("start", "feat")).toContain(
    "Pick the reviewer's model by the model you run on: if you run on claude-opus-5.5, gpt-6.1-sol at high effort; " +
      "if you run on gpt-6.1-sol, claude-opus-5.6. If yours is not listed, follow the review guide.",
  );
});

test("a launch command replaces the subagent, and the findings file stays where the author reads it", () => {
  expect(repo.start("feat", FLOW)).toContain("Start the reviewer as a fresh subagent in your own harness");

  repo.write(".konductor/policy-overrides.yml", 'review:\n  launch:\n    command: opencode run -m {model} "$(cat {prompt_file})"\n');
  const out = repo.ok("start", "feat");
  expect(out).not.toContain("fresh subagent");
  expect(out).toContain(
    'Start the reviewer with `opencode run -m {model} "$(cat {prompt_file})"`, with none of your context. In a launch ' +
      "command, replace {model} and {effort} with the reviewer's, {prompt_file} with a file you write the review " +
      "request to, and {findings_file} with the findings file.",
  );
  expect(out).toContain("The reviewer writes its findings to .konductor/reviews/feat/build-round-<n>.json");
  // Findings are private to the checkout, like the workstream state.
  expect(repo.read(".konductor/reviews/.gitignore")).toBe("*\n");
});

test("a reviewer row can be started its own way, such as a model only another harness runs", () => {
  repo.write(
    "home/.konductor/policy-overrides.yml",
    "review:\n  reviewers:\n" +
      "    claude-opus-5.5:\n      model: gpt-6.1-sol\n      launch:\n        command: opencode run -m {model}\n" +
      "    gpt-6.1-sol: { model: claude-opus-5.5, launch: subagent }\n",
  );
  const out = repo.start("feat", FLOW);
  expect(out).toContain(
    "if you run on claude-opus-5.5, gpt-6.1-sol, started with `opencode run -m {model}`; if you run on gpt-6.1-sol, " +
      "claude-opus-5.5. If yours is not listed, follow the review guide. Unless its row says otherwise, start the " +
      "reviewer as a fresh subagent in your own harness, with none of your context. In a launch command, replace {model}",
  );
});

test("the owner's rulings from every policy file are printed with the step, the user's first", () => {
  expect(repo.start("feat", FLOW)).not.toContain("RULINGS");

  repo.write("home/.konductor/policy-overrides.yml", "rulings:\n  - Commit messages follow the house rules.\n");
  repo.write(
    ".konductor/policy-overrides.local.yml",
    "rulings:\n  - In fuse-flow workstreams, the workflow's review gates replace the code-review skill's own review loop.\n",
  );
  expect(repo.ok("start", "feat")).toContain(
    "STEP build (1 of 1): Build it.\n" +
      "RULINGS: where this workflow and other installed rules overlap, the owner ruled:\n" +
      "  - Commit messages follow the house rules.\n" +
      "  - In fuse-flow workstreams, the workflow's review gates replace the code-review skill's own review loop.\n",
  );
});

test("a launch that is neither subagent nor a command is refused with the file that holds it", () => {
  repo.start("feat", FLOW);
  repo.write(".konductor/policy-overrides.yml", "review:\n  launch: terminal\n");
  expect(repo.refused("start", "feat")).toContain(".konductor/policy-overrides.yml is not a valid policy file");
});

test("on a step with a review, the lines for stopping early ask for the rounds used and any required fix still open", () => {
  expect(repo.start("feat", FLOW)).toContain(
    "  VERIFICATION: <the check results so far, the review rounds used of the cap, and any required fix still open; or none>\n",
  );
});
