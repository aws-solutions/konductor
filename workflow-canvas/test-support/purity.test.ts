// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  importedModules,
  problemsIn as scan,
  sourcesUnder,
  type PurityRules,
} from './purity.ts';

// The rules of the stub core: its own modules, yaml and createHash.
const RULES: PurityRules = {
  dir: '/core/',
  allowedPackages: new Set(['yaml']),
  allowedNames: { 'node:crypto': ['createHash'] },
};
const problemsIn = (file: string, source: string) => scan(file, source, RULES);

describe('the scan, on code that breaks the rules', () => {
  const HASH = "import { createHash } from 'node:crypto';\n";

  it('accepts the named import of createHash and own modules', () => {
    const source = `${HASH}import { a } from './a.ts';\nimport { b } from './sub/b.ts';\n`;
    expect(problemsIn('x.ts', source)).toEqual([]);
  });

  it.each([
    ['randomBytes', "import { createHash, randomBytes } from 'node:crypto';"],
    ['a renamed randomUUID', "import { randomUUID as id } from 'node:crypto';"],
    ['a namespace import of node:crypto', "import * as c from 'node:crypto';"],
    ['a default import of node:crypto', "import crypto from 'node:crypto';"],
    [
      'a dynamic import of node:crypto',
      "const c = await import('node:crypto');",
    ],
    ['node:fs', "import { readFileSync } from 'node:fs';"],
    ['a module above core', "import { x } from '../http/server.ts';"],
    ['a package that is not allowed', "import x from 'express';"],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line)).not.toEqual([]);
  });

  it.each([
    ['Date.now()', 'const t = Date.now();'],
    ['new Date()', 'const t = new Date();'],
    ['new Date(ms)', 'const t = new Date(ms);'],
    ['Date()', 'const t = Date();'],
    ['Math.random()', 'const r = Math.random();'],
    ['performance.now()', 'const t = performance.now();'],
    ['randomUUID()', 'const id = randomUUID();'],
    ['randomBytes()', 'const b = randomBytes(8);'],
    ['getRandomValues()', 'crypto.getRandomValues(new Uint8Array(4));'],
    ['globalThis.crypto', 'const id = globalThis.crypto.randomUUID();'],
    ['process.env', 'const v = process.env.HOME;'],
    ['setTimeout()', 'setTimeout(() => {}, 1);'],
    ['fetch()', "await fetch('http://x');"],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', `${HASH}${line}\n`)).not.toEqual([]);
  });

  it('walks sub-directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'purity-'));
    try {
      mkdirSync(join(dir, 'deep'));
      writeFileSync(
        join(dir, 'deep', 'bad.ts'),
        'export const t = Date.now();',
      );
      writeFileSync(join(dir, 'deep', 'bad.test.ts'), '');
      expect(sourcesUnder(dir).map((s) => s.file)).toEqual(['deep/bad.ts']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('finds static, side-effect, re-export and dynamic imports', () => {
    const source = [
      "import { a } from 'node:fs';",
      'import type { B } from "./b.ts";',
      "import 'node:http';",
      "export { c } from 'node:net';",
      "const d = await import('node:child_process');",
    ].join('\n');
    expect(importedModules(source)).toEqual([
      'node:fs',
      './b.ts',
      'node:http',
      'node:net',
      'node:child_process',
    ]);
  });
});
