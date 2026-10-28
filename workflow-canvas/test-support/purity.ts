// SPDX-License-Identifier: Apache-2.0
/**
 * The scan behind the "no IO" tests of an IO-free core. It reads each source
 * as TypeScript, not as text, so a word in a comment or a string is not code
 * and an alias of a forbidden name is still caught. A core may import its own
 * modules and the packages and names that its rules allow, and may not reach
 * a clock, randomness, the environment, the page, storage or the network. It
 * guards against accidents; it is not a sandbox.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { lineOf, parse, walk, type ParsedSource } from './purity-ast.ts';
import { FORBIDDEN_GLOBALS, FORBIDDEN_MEMBERS } from './purity-globals.ts';
import { importsOf, type ModuleImport } from './purity-imports.ts';

/** What one core may import. Anything else is a problem. */
export interface PurityRules {
  /** The core's directory, as a path that ends in a separator. */
  dir: string;
  /** Packages that any file of the core may import. */
  allowedPackages: ReadonlySet<string>;
  /** A module that is otherwise not allowed, with the names it may give. */
  allowedNames: Readonly<Record<string, readonly string[]>>;
}

function isOwnModule(specifier: string, file: string, rules: PurityRules) {
  if (!specifier.startsWith('.')) return false;
  const from = new URL(file, `file://${rules.dir}`);
  const target = fileURLToPath(new URL(specifier, from));
  return target.startsWith(rules.dir);
}

function isAllowedImport(
  { specifier, names }: ModuleImport,
  file: string,
  rules: PurityRules,
): boolean {
  if (specifier === undefined) return false;
  const allowed = rules.allowedNames[specifier];
  if (allowed)
    return names !== undefined && names.every((n) => allowed.includes(n));
  return (
    rules.allowedPackages.has(specifier) || isOwnModule(specifier, file, rules)
  );
}

function importProblems(
  { file, name }: { file: ts.SourceFile; name: string },
  rules: PurityRules,
): string[] {
  return importsOf(file)
    .filter((found) => !isAllowedImport(found, name, rules))
    .map(
      (found) =>
        `${name}:${lineOf(found.node, file)} imports ${found.specifier ?? 'a module with a computed name'}`,
    );
}

// A name that is only a label: a property, a member or an import binding.
function isLabel(id: ts.Identifier): boolean {
  const { parent } = id;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === id;
  if (ts.isQualifiedName(parent)) return parent.right === id;
  if (ts.isBindingElement(parent)) return parent.propertyName === id;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isJsxAttribute(parent) || ts.isEnumMember(parent)) return true;
  if (ts.isLabeledStatement(parent)) return true;
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === id
  );
}

// A name in a type, which runs nothing. `extends Date` of a class does run.
function isInType(id: ts.Identifier): boolean {
  for (let node: ts.Node = id; !ts.isSourceFile(node); node = node.parent) {
    if (!ts.isTypeNode(node)) continue;
    const extendsClass =
      ts.isExpressionWithTypeArguments(node) &&
      ts.isHeritageClause(node.parent) &&
      node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
      ts.isClassLike(node.parent.parent);
    return !extendsClass;
  }
  return false;
}

function isDeclaredInFile({ checker }: ParsedSource, id: ts.Identifier) {
  const symbol = ts.isShorthandPropertyAssignment(id.parent)
    ? checker.getShorthandAssignmentValueSymbol(id.parent)
    : checker.getSymbolAtLocation(id);
  return (symbol?.declarations ?? []).length > 0;
}

/** The name of `Object.member` or `Object['member']` when `id` is `Object`. */
function memberOf(id: ts.Identifier): string | undefined {
  const { parent } = id;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
    return parent.name.text;
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === id) {
    const arg = parent.argumentExpression;
    return ts.isStringLiteralLike(arg) ? arg.text : '[computed]';
  }
  return undefined;
}

function problemOfIdentifier(
  parsed: ParsedSource,
  id: ts.Identifier,
): string | undefined {
  const name = id.text;
  if (isLabel(id) || isInType(id) || isDeclaredInFile(parsed, id))
    return undefined;
  const members = FORBIDDEN_MEMBERS[name];
  if (members) {
    const member = memberOf(id);
    if (member === undefined)
      return `uses ${name} other than as ${name}.<member>`;
    return members.has(member) || member === '[computed]'
      ? `uses ${name}.${member}`
      : undefined;
  }
  return FORBIDDEN_GLOBALS.has(name) ? `uses ${name}` : undefined;
}

function referenceProblems(parsed: ParsedSource, name: string): string[] {
  const { file } = parsed;
  return [...walk(file)].flatMap((node) => {
    const isMeta =
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword;
    const found = isMeta
      ? 'uses import.meta'
      : ts.isIdentifier(node)
        ? problemOfIdentifier(parsed, node)
        : undefined;
    return found ? [`${name}:${lineOf(node, file)} ${found}`] : [];
  });
}

/** Every way that a core source breaks the rules of the core. */
export function problemsIn(
  file: string,
  source: string,
  rules: PurityRules,
): string[] {
  const parsed = parse(file, source);
  return [
    ...importProblems({ file: parsed.file, name: file }, rules),
    ...referenceProblems(parsed, file),
  ];
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
