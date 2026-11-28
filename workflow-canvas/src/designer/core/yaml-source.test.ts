// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import {
  applyPatches,
  insertMapPair,
  isMap,
  parseDocument,
  uniquePair,
} from './yaml-source';

it('inserts after an inline comment without a final newline', () => {
  const text = `intent:\n  outcome: Ship it. # keep with outcome`;
  const document = parseDocument(text);
  expect(isMap(document.contents)).toBe(true);
  if (!isMap(document.contents)) throw new Error('Expected a root map.');
  const intent = uniquePair(document.contents, 'intent');
  expect(intent).not.toBe('duplicate');
  expect(intent).toBeDefined();
  if (!intent || intent === 'duplicate' || !isMap(intent.value)) {
    throw new Error('Expected an intent map.');
  }
  const patch = insertMapPair(text, intent.value, 'accept', '[check]');
  expect(patch).toBeDefined();
  expect(applyPatches(text, patch ? [patch] : [])).toBe(
    `${text}\n  accept: [check]`,
  );
});
