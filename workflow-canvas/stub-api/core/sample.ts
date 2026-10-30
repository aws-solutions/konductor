// SPDX-License-Identifier: Apache-2.0

/** The workflow the stub serves, and so the root of its session. */
export const SAMPLE_ROOT = 'hello';

/**
 * The one fixed workflow file: a draft stage, then a review stage. It shows
 * the keys of the first release. The `prompt_file` is a path only, because the
 * stub reads no files.
 */
export const SAMPLE_FILES: Readonly<Record<string, string>> = {
  [SAMPLE_ROOT]: `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Add a greeting to the README
  accept:
    - id: readme-exists
      file: README.md
params:
  goal:
    description: What the workflow should accomplish.
    default: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
    prompt: Write the greeting to README.md.
  - name: review
    agent: k-quality-assurance
    prompt_file: review.md
`,
};
