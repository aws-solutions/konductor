// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { draftOf } from './draft';
import {
  declaredOutputLinkError,
  linkSourceNameError,
  pathValueError,
} from './link-validation';

it.each([
  ['invalid', 'Bad_Name', 'Fix the source stage name'],
  ['reserved', 'run', 'reserved stage name'],
])('rejects an %s source stage name', (_, name, message) => {
  const draft = draftOf([{ name, agent: 'k-architect' }]);
  expect(linkSourceNameError(draft, 's1')).toContain(message);
});

it('rejects a duplicate source stage name', () => {
  const draft = draftOf([
    { name: 'same', agent: 'k-architect' },
    { name: 'same', agent: 'k-developer' },
  ]);
  expect(linkSourceNameError(draft, 's1')).toContain('unique');
});

it.each(['../DESIGN.md', '/tmp/x', 'a\\b', 'a//b', 'C:x'])(
  'rejects invalid output path %s',
  (path) => {
    expect(pathValueError(path)).toBeDefined();
    const draft = draftOf([
      {
        name: 'plan',
        agent: 'k-architect',
        outputs: { design: path },
      },
    ]);
    expect(declaredOutputLinkError(draft, 's1', 'design')).toBeDefined();
  },
);
