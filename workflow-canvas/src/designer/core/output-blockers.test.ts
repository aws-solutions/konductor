// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import type { WorkflowDocument } from '../../api/types';
import { HELLO_DOCUMENT } from '../../test-support/fixtures';
import { reduce } from './edit-reducer';
import { openDocument } from './edit-state';
import { outputsBlocker, textOf } from './edit-view';

const TEXT = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Do it.
stages:
  - name: plan
    agent: k-architect
    outputs:
      # keep
      design: DESIGN.md
  - name: build
    agent: k-developer
    outputs: {note: NOTE.md}
`;

const DOCUMENT: WorkflowDocument = {
  ...HELLO_DOCUMENT,
  text: TEXT,
  view: {
    name: 'hello',
    intent: { outcome: 'Do it.' },
    stages: [
      {
        name: 'plan',
        kind: 'agent' as const,
        agent: 'k-architect',
        outputs: { design: 'DESIGN.md' },
        range: { line: 7, end_line: 11 },
      },
      {
        name: 'build',
        kind: 'agent' as const,
        agent: 'k-developer',
        outputs: { note: 'NOTE.md' },
        range: { line: 12, end_line: 14 },
      },
    ],
  },
};

it('scopes structural refusals and preserves unrelated stage saves', () => {
  const opened = openDocument(DOCUMENT)!;
  expect(outputsBlocker(opened, 's1', true)).toContain('comments');
  expect(outputsBlocker(opened, 's1', false)).toBeUndefined();
  expect(outputsBlocker(opened, 's2', true)).toBeUndefined();

  const renamed = reduce(opened, { type: 'rename', id: 's2', name: 'ship' })!;
  expect(textOf(renamed)).toBe(TEXT.replace('name: build', 'name: ship'));
});
