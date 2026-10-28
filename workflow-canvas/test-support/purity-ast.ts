// SPDX-License-Identifier: Apache-2.0
import ts from 'typescript';

/** A parsed source file with the checker that resolves its names. */
export interface ParsedSource {
  file: ts.SourceFile;
  checker: ts.TypeChecker;
}

/**
 * Parses `source` with no library and no module resolution, so a name that
 * the file declares itself has a symbol and a global has none.
 */
export function parse(name: string, source: string): ParsedSource {
  const kind = name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (requested) => (requested === name ? file : undefined);
  host.fileExists = (requested) => requested === name;
  host.readFile = (requested) => (requested === name ? source : undefined);
  const program = ts.createProgram([name], options, host);
  return { file, checker: program.getTypeChecker() };
}

/** Every node of the tree below `root`, `root` first. */
export function* walk(root: ts.Node): Generator<ts.Node> {
  yield root;
  for (const child of root.getChildren()) yield* walk(child);
}

/** The line, counted from 1, where `node` starts. */
export function lineOf(node: ts.Node, file: ts.SourceFile): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}
