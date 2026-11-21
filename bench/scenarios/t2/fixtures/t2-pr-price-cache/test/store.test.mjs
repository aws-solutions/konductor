import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JsonStore } from '../src/store/json-store.mjs';
import { tempData, writeJson } from './helpers.mjs';

test('json store reads and atomically writes values', async (t) => {
  const dir = await tempData();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeJson(dir, 'sample.json', { ok: true });
  const store = new JsonStore(dir);
  assert.deepEqual(await store.read('sample.json'), { ok: true });
  await store.write('sample.json', { count: 2 });
  assert.deepEqual(await store.read('sample.json'), { count: 2 });
});
