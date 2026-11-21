// SPDX-License-Identifier: Apache-2.0
/*
 * Workflow texts and the `range` the API gives each stage, for the tests of
 * the YAML pane. A test (yaml-pane-ranges.test.ts) checks the ranges against
 * the stub's reader of the contract.
 */

export interface SampleText {
  readonly text: string;
  readonly stages: readonly {
    readonly name: string;
    readonly range: { readonly line: number; readonly end_line: number };
  }[];
}

/** Stages in block form, after the other keys, with a break at the end. */
export const BLOCK: SampleText = {
  text: [
    'format: konductor/1',
    'name: hello',
    'version: 0.1.0',
    'intent:',
    '  outcome: Add a greeting to the README',
    'stages:',
    '  - name: draft',
    '    agent: k-developer',
    '    prompt: Write the greeting to README.md.',
    '  - name: review',
    '    agent: k-quality-assurance',
    '  - name: wrap-up',
    '    agent: k-developer',
    '',
  ].join('\n'),
  stages: [
    { name: 'draft', range: { line: 7, end_line: 9 } },
    { name: 'review', range: { line: 10, end_line: 11 } },
    { name: 'wrap-up', range: { line: 12, end_line: 13 } },
  ],
};

/** Stages in block form before the other keys, with CRLF line ends. */
export const STAGES_FIRST: SampleText = {
  text: [
    'stages:',
    '  - name: draft',
    '    agent: k-developer',
    'format: konductor/1',
    'name: hello',
    'version: 0.1.0',
    'intent:',
    '  outcome: Add a greeting to the README',
  ].join('\r\n'),
  stages: [{ name: 'draft', range: { line: 2, end_line: 3 } }],
};

/** Two stages in flow form on one line. */
export const FLOW: SampleText = {
  text: [
    'format: konductor/1',
    'name: hello',
    'version: 0.1.0',
    'intent:',
    '  outcome: Add a greeting to the README',
    'stages: [{ name: draft, agent: k-developer }, { name: review, agent: k-quality-assurance }]',
    '',
  ].join('\n'),
  stages: [
    { name: 'draft', range: { line: 6, end_line: 6 } },
    { name: 'review', range: { line: 6, end_line: 6 } },
  ],
};
