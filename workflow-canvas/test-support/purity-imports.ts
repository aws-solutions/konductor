// SPDX-License-Identifier: Apache-2.0
import ts from 'typescript';
import { walk } from './purity-ast.ts';

/**
 * One import of a module. `names` lists what is taken from it, or is
 * `undefined` when that is not known: a default, a namespace, `export *` or a
 * dynamic import.
 */
export interface ModuleImport {
  /** The module, or `undefined` when its name is computed. */
  specifier: string | undefined;
  names: string[] | undefined;
  node: ts.Node;
}

function namesOfClause(
  clause: ts.ImportClause | undefined,
): string[] | undefined {
  if (!clause) return [];
  const { name, namedBindings } = clause;
  if (name || (namedBindings && ts.isNamespaceImport(namedBindings))) {
    return undefined;
  }
  if (!namedBindings) return [];
  return namedBindings.elements.map(
    (element) => (element.propertyName ?? element.name).text,
  );
}

function namesOfExport(node: ts.ExportDeclaration): string[] | undefined {
  const { exportClause } = node;
  if (!exportClause || !ts.isNamedExports(exportClause)) return undefined;
  return exportClause.elements.map(
    (element) => (element.propertyName ?? element.name).text,
  );
}

const textOf = (node: ts.Expression | undefined) =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;

function importOf(node: ts.Node): ModuleImport | undefined {
  if (ts.isImportDeclaration(node)) {
    const specifier = textOf(node.moduleSpecifier);
    return { specifier, names: namesOfClause(node.importClause), node };
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
    const specifier = textOf(node.moduleSpecifier);
    return { specifier, names: namesOfExport(node), node };
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const specifier = textOf(node.moduleReference.expression);
    return { specifier, names: undefined, node };
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    return { specifier: textOf(node.arguments[0]), names: undefined, node };
  }
  if (ts.isImportTypeNode(node)) {
    const literal = ts.isLiteralTypeNode(node.argument)
      ? node.argument.literal
      : undefined;
    const specifier =
      literal && ts.isStringLiteral(literal) ? literal.text : undefined;
    return { specifier, names: undefined, node };
  }
  return undefined;
}

/** Every import, re-export and dynamic import of a source file. */
export function importsOf(file: ts.SourceFile): ModuleImport[] {
  return [...walk(file)].flatMap((node) => importOf(node) ?? []);
}
