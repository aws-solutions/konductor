// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * Checks that the core does no IO: it imports only its own modules, the yaml
 * parser and node:crypto (a hash is a calculation), and it does not read the
 * clock, randomness, the environment or the network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE_DIR = fileURLToPath(new URL('.', import.meta.url));
const ALLOWED_PACKAGES = new Set(['yaml', 'node:crypto']);
const IMPURE_CALLS = [
  /\bDate\.now\b/,
  /\bnew Date\(\s*\)/,
  /\bMath\.random\b/,
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

function isOwnModule(specifier: string): boolean {
  return specifier.startsWith('./') && !specifier.slice(2).includes('/');
}

function coreSources(): { file: string; source: string }[] {
  return readdirSync(CORE_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({
      file,
      source: readFileSync(new URL(file, import.meta.url), 'utf8'),
    }));
}

describe('the core', () => {
  it('has sources to check', () => {
    expect(coreSources().length).toBeGreaterThan(5);
  });

  it('imports only its own modules and the allowed packages', () => {
    const stray = coreSources().flatMap(({ file, source }) =>
      importedModules(source)
        .filter((m) => !isOwnModule(m) && !ALLOWED_PACKAGES.has(m))
        .map((m) => `${file} imports ${m}`),
    );
    expect(stray).toEqual([]);
  });

  it('reads no clock, randomness, environment or network', () => {
    const impure = coreSources().flatMap(({ file, source }) =>
      IMPURE_CALLS.filter((call) => call.test(source)).map(
        (call) => `${file} matches ${call}`,
      ),
    );
    expect(impure).toEqual([]);
  });
});

describe('the import scan', () => {
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

  it('rejects a module that does IO', () => {
    expect(isOwnModule('node:fs')).toBe(false);
    expect(ALLOWED_PACKAGES.has('node:fs')).toBe(false);
    expect(isOwnModule('../http/server.ts')).toBe(false);
  });
});
