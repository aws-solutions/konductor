// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
    ['localStorage', "const v = localStorage.getItem('k');"],
    ['sessionStorage', "sessionStorage.setItem('k', 'v');"],
    ['window.location', 'const u = window.location.href;'],
    ['document.title', 'const t = document.title;'],
    ['XMLHttpRequest', 'const x = new XMLHttpRequest();'],
    ['WebSocket', "const w = new WebSocket('ws://x');"],
    ['EventSource', "const e = new EventSource('/x');"],
    ['navigator.sendBeacon', "navigator.sendBeacon('/x');"],
    ['import.meta.env', 'const m = import.meta.env.MODE;'],
    ['queueMicrotask()', 'queueMicrotask(() => {});'],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', `${HASH}${line}\n`)).not.toEqual([]);
  });

  it.each([
    ['a line comment', '// the Date and the process are not read here'],
    ['a block comment', '/* process, Date, fetch( and window.x */'],
    ['a doc comment', '/**\n * Never calls Math.random.\n */'],
  ])('does not flag a word in %s', (_, comment) => {
    expect(problemsIn('x.ts', `${comment}\nexport const a = 1;\n`)).toEqual([]);
  });

  it('still flags code that follows a comment on the same line', () => {
    expect(problemsIn('x.ts', 'const a = 1; // fine\nDate.now();')).not.toEqual(
      [],
    );
  });

  it('does not take a URL in a string for a comment', () => {
    expect(
      problemsIn('x.ts', "const u = 'http://x'; const t = Date.now();"),
    ).not.toEqual([]);
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
});

describe('the scan, on code that gets round a word match', () => {
  it.each([
    ['an alias of fetch', 'const f = fetch; f("/x");'],
    ['fetch passed on', 'run(fetch);'],
    ['fetch in a destructuring', 'const { fetch: f } = globalThis;'],
    ['a computed key of globalThis', "globalThis['fet' + 'ch']('/x');"],
    ['an alias of window', 'const w = window; w.x();'],
    ['an alias of Date', 'const D = Date; new D();'],
    ['a class that extends Date', 'class A extends Date {}'],
    ['Math.random through an alias', 'const m = Math; m.random();'],
    ['a destructured Math.random', 'const { random } = Math;'],
    ["Math['random']", "Math['random']();"],
    ['a computed member of Math', 'Math[name]();'],
    ['AbortSignal.timeout', 'AbortSignal.timeout(10);'],
    ['requestAnimationFrame', 'requestAnimationFrame(() => {});'],
    ['cancelAnimationFrame', 'cancelAnimationFrame(1);'],
    ['indexedDB', "indexedDB.open('x');"],
    ['Intl', 'new Intl.DateTimeFormat().format();'],
    ['eval', 'eval("1");'],
    ['import.meta', 'const e = import.meta.env.MODE;'],
    ['import.meta without env', 'const u = import.meta.url;'],
    ['a shorthand property', 'const o = { fetch };'],
    ['a JSX use', 'const a = <div onClick={fetch} />;'],
  ])('rejects %s', (_, code) => {
    expect(problemsIn('x.tsx', code)).not.toEqual([]);
  });

  it.each([
    ['an import by a computed name', 'await import(name);'],
    ['require', "const x = require('./a.ts');"],
    ['an import type of a module above', "type T = import('../up.ts').T;"],
    ['a side-effect import', "import 'node:http';"],
    ['a re-export', "export { c } from 'node:net';"],
    ['export *', "export * from 'node:net';"],
    ['an import = require', "import fs = require('node:fs');"],
  ])('rejects %s', (_, code) => {
    expect(problemsIn('x.ts', code)).not.toEqual([]);
  });

  it.each([
    ['a // inside a string', "const u = 'http://x'; const t = Date.now();"],
    ['a // inside a template', 'const u = `a // b`; fetch(u);'],
    ['a /* inside a string', "const u = '/*'; const t = Date.now(); // */"],
    ['a regular expression with //', 'const r = /a\\//; fetch("/x");'],
  ])('still reads the code after %s', (_, code) => {
    expect(problemsIn('x.ts', code)).not.toEqual([]);
  });

  it('names the file and line of a problem', () => {
    expect(problemsIn('x.ts', 'const a = 1;\nconst t = Date.now();')).toEqual([
      'x.ts:2 uses Date',
    ]);
  });
});

describe('the scan, on code that only looks like IO', () => {
  it.each([
    [
      'a parameter called document',
      'export const f = (document: string) => document.length;',
    ],
    [
      'a local called window',
      'const window = [1, 2]; export const w = window.length;',
    ],
    [
      'a variable called history',
      'const history: string[] = []; history.push("a");',
    ],
    [
      'a property called fetch',
      'const o = { fetch: 1 }; export const n = o.fetch;',
    ],
    [
      'a method called Date',
      'const o = { Date() { return 1; } }; export const n = o.Date();',
    ],
    ['a destructured property name', 'const { process: step } = job; step();'],
    ['a type called Date', 'export interface A { at: Date }'],
    ['typeof fetch in a type', 'export type F = typeof fetch;'],
    [
      'an import binding called fetch',
      "import { fetch } from './net.ts'; fetch();",
    ],
    ['Math.floor', 'export const n = Math.floor(1.5);'],
    [
      'an enum member called Date',
      'enum K { Date, Time }; export const k = K.Date;',
    ],
    [
      'an object key called window',
      "export const o = { window: 1, 'document': 2 };",
    ],
    ['a string that names fetch', 'export const s = "fetch(" + "Date.now()";'],
    ['a template that names fetch', 'export const s = `window.${1} Date`;'],
    [
      'a comment',
      '// Date, process and fetch( in a comment\nexport const a = 1;',
    ],
    [
      'a block comment',
      '/** Never calls Math.random or window.x. */\nexport const a = 1;',
    ],
  ])('accepts %s', (_, code) => {
    expect(problemsIn('x.ts', code)).toEqual([]);
  });
});

describe('the scan, on imports', () => {
  it('reads static, side-effect, re-export and dynamic imports', () => {
    const source = [
      "import { a } from 'node:fs';",
      'import type { B } from "./b.ts";',
      "import 'node:http';",
      "export { c } from 'node:net';",
      "const d = await import('node:child_process');",
    ].join('\n');

    expect(problemsIn('x.ts', source)).toEqual([
      'x.ts:1 imports node:fs',
      'x.ts:3 imports node:http',
      'x.ts:4 imports node:net',
      'x.ts:5 imports node:child_process',
    ]);
  });

  it('allows a package of the rules and a name of the rules', () => {
    const source =
      "import { parse } from 'yaml';\nimport { createHash } from 'node:crypto';";

    expect(problemsIn('x.ts', source)).toEqual([]);
  });

  it('rejects a name that the rules do not give, even with an allowed one', () => {
    const source = "import { createHash, randomBytes } from 'node:crypto';";

    expect(problemsIn('x.ts', source)).toEqual(['x.ts:1 imports node:crypto']);
  });
});
