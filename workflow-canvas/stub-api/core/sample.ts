// SPDX-License-Identifier: Apache-2.0

/** The workflow the stub serves, and so the root of its session. */
export const SAMPLE_ROOT = 'hello';

/** The one fixed workflow file: a draft stage, then a review stage. */
export const SAMPLE_FILES: Readonly<Record<string, string>> = {
  [SAMPLE_ROOT]: `name: hello
intent: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`,
};
