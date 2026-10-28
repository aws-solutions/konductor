// SPDX-License-Identifier: Apache-2.0
/**
 * The scan behind the "no IO" tests of an IO-free core. A core may import its
 * own modules and the packages and names that its rules allow, and may not
 * read a clock, randomness, the environment, the page, storage or the network.
 * Comments are not scanned.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What one core may import. Anything else is a problem. */
export interface PurityRules {
  /** The core's directory, as a path that ends in a separator. */
  dir: string;
  /** Packages that any file of the core may import. */
  allowedPackages: ReadonlySet<string>;
  /** A module that is otherwise not allowed, with the names it may give. */
  allowedNames: Readonly<Record<string, readonly string[]>>;
}

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
  /\b(?:window|document|navigator|globalThis)\s*[.[]\s*\w/,
  /\b(?:localStorage|sessionStorage|XMLHttpRequest|WebSocket|EventSource)\b/,
  /\bnavigator\.sendBeacon\b/,
  /\bimport\.meta\.env\b/,
  /\bqueueMicrotask\b/,
];

/** The source without its comments, so a word in a comment is not a call. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** The module names that a source file imports, statically or dynamically. */
export function importedModules(source: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

/** The names of the `import { a, b as c } from 'module'` statements. */
export function namedImports(source: string, module: string): string[] {
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

function isOwnModule(
  specifier: string,
  fromFile: string,
  rules: PurityRules,
): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = fileURLToPath(
    new URL(specifier, `file://${rules.dir}${fromFile}`),
  );
  return target.startsWith(rules.dir);
}

function isAllowedImport(
  specifier: string,
  fromFile: string,
  source: string,
  rules: PurityRules,
): boolean {
  const names = rules.allowedNames[specifier];
  if (names) {
    const count = importedModules(source).filter((m) => m === specifier).length;
    const named = namedImports(source, specifier);
    return named.length >= count && named.every((n) => names.includes(n));
  }
  return (
    rules.allowedPackages.has(specifier) ||
    isOwnModule(specifier, fromFile, rules)
  );
}

/** Every way that a core source breaks the rules of the core. */
export function problemsIn(
  file: string,
  source: string,
  rules: PurityRules,
): string[] {
  const imports = importedModules(source)
    .filter((module) => !isAllowedImport(module, file, source, rules))
    .map((module) => `${file} imports ${module}`);
  const code = withoutComments(source);
  const calls = IMPURE.filter((pattern) => pattern.test(code)).map(
    (pattern) => `${file} matches ${pattern}`,
  );
  return [...imports, ...calls];
}

/** The `.ts` and `.tsx` sources under a directory, tests left out. */
export function sourcesUnder(dir: string): { file: string; source: string }[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }));
}

/** The problems of every source under the directory of the rules. */
export function problemsUnder(rules: PurityRules): string[] {
  return sourcesUnder(rules.dir).flatMap(({ file, source }) =>
    problemsIn(file, source, rules),
  );
}
