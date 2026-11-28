// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import {
  scalarSequencePatches,
  scalarSequenceSource,
  type ScalarSequenceSource,
} from './source-sequence';
import { applyPatches, isMap, parseDocument, uniquePair } from './yaml-source';

it('reads scalar sequence source and patches one flow item', () => {
  const text = 'values: [old, keep]';
  const document = parseDocument(text);
  expect(isMap(document.contents)).toBe(true);
  if (!isMap(document.contents)) throw new Error('Expected a map.');
  const pair = uniquePair(document.contents, 'values');
  expect(pair).not.toBe('duplicate');
  expect(pair).toBeDefined();
  if (!pair || pair === 'duplicate') throw new Error('Expected values.');
  const source = scalarSequenceSource(text, pair.value);
  expect(source).toBeDefined();
  if (!source) throw new Error('Expected a scalar sequence.');

  const changed = scalarSequencePatches(text, source, ['new', 'keep']);

  expect(changed.structuralComment).toBeUndefined();
  expect(applyPatches(text, changed.patches ?? [])).toBe('values: [new, keep]');
});

it('adds one block item with the source EOL and indent', () => {
  const text = 'values:\r\n  - old\r\n';
  const start = text.indexOf('old');
  const source: ScalarSequenceSource = {
    flow: false,
    close: text.length,
    indent: '  ',
    items: [{ text: 'old', range: [start, start + 3] }],
    hasComments: false,
  };

  const changed = scalarSequencePatches(text, source, ['old', 'new']);

  expect(applyPatches(text, changed.patches ?? [])).toBe(
    'values:\r\n  - old\r\n  - new\r\n',
  );
});

it('reports a structural comment instead of moving it', () => {
  const source: ScalarSequenceSource = {
    flow: true,
    close: 4,
    indent: '',
    items: [{ text: 'old', range: [1, 4] }],
    hasComments: true,
  };
  expect(scalarSequencePatches('[old]', source, ['old', 'new'])).toEqual({
    structuralComment: true,
  });
});
