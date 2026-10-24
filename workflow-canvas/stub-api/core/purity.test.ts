// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the core does no IO and reads no clock, randomness or
 * environment. It may import its own modules, `yaml` and `createHash`.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE_DIR = fileURLToPath(new URL('.', import.meta.url));
const ALLOWED_PACKAGES = new Set(['yaml']);
// A named import is allowed from a module that is otherwise not: the names.
const ALLOWED_NAMES: Readonly<Record<string, readonly string[]>> = {
  'node:crypto': ['createHash'],
};
const IMPURE = [
  /\bDate\b/,
  /\bMath\.random\b/,
  /\bperformance\b/,
  /\b(?:randomBytes|randomUUID|randomInt|randomFillSync|getRandomValues)\b/,
  /\bcrypto\./,
  /\bprocess\b/,
  /\b(?:setTimeout|setInterval|setImmediate)\b/,
  /\bfetch\s*\(/,
  /\brequire\s*\(/,
];

/** The module names that a source file imports, statically or dynamically. */
function importedModules(source: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

/** The names of the `import { a, b as c } from 'module'` statements. */
function namedImports(source: string, module: string): string[] {
  const pattern = new RegExp(
    `\\bimport\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${module}['"]`,
    'g',
  );
  return [...source.matchAll(pattern)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map(
        (name) =>
          name
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0] ?? '',
      )
      .filter((name) => name !== ''),
  );
}

function isOwnModule(specifier: string, fromFile: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = fileURLToPath(
    new URL(specifier, `file://${CORE_DIR}${fromFile}`),
  );
  return target.startsWith(CORE_DIR);
}

function isAllowedImport(specifier: string, fromFile: string, source: string) {
  const names = ALLOWED_NAMES[specifier];
  if (names) {
    const count = importedModules(source).filter((m) => m === specifier).length;
    const named = namedImports(source, specifier);
    return named.length >= count && named.every((n) => names.includes(n));
  }
  return ALLOWED_PACKAGES.has(specifier) || isOwnModule(specifier, fromFile);
}

/** Every way that a core source breaks the rules of the core. */
function problemsIn(file: string, source: string): string[] {
  const imports = importedModules(source)
    .filter((module) => !isAllowedImport(module, file, source))
    .map((module) => `${file} imports ${module}`);
  const calls = IMPURE.filter((pattern) => pattern.test(source)).map(
    (pattern) => `${file} matches ${pattern}`,
  );
  return [...imports, ...calls];
}

/** The `.ts` sources under a directory, at any depth, tests left out. */
function sourcesUnder(dir: string): { file: string; source: string }[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }));
}

const coreSources = () => sourcesUnder(CORE_DIR);

describe('the core', () => {
  it('has sources to check', () => {
    expect(coreSources().length).toBeGreaterThan(5);
  });

  it('imports only its own modules, yaml and createHash, and reads no clock, randomness, environment or network', () => {
    const problems = coreSources().flatMap(({ file, source }) =>
      problemsIn(file, source),
    );
    expect(problems).toEqual([]);
  });
});

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
