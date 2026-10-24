// SPDX-License-Identifier: Apache-2.0
import type { Diagnostic, DiagnosticCode } from './model.ts';
import type { SourceMap } from './source-map.ts';

/** A step in a key path: a key, or the place of a list entry. */
export type Segment = string | number;
/** Start and end offsets in the text; the end is the first place after. */
export type Span = readonly [start: number, end: number];

interface Found {
  start: number;
  diagnostic: Diagnostic;
}

/**
 * Collects the diagnostics of one check. A stage is addressed by its name
 * when it has a usable one, and by its place in the list otherwise.
 */
export class Reporter {
  private readonly file: string;
  private readonly source: SourceMap;
  private readonly found: Found[] = [];
  private stageNames: readonly (string | undefined)[] = [];

  constructor(file: string, source: SourceMap) {
    this.file = file;
    this.source = source;
  }

  nameStages(names: readonly (string | undefined)[]): void {
    this.stageNames = names;
  }

  report(
    code: DiagnosticCode,
    path: readonly Segment[],
    span: Span,
    message: string,
    suggestion?: string,
  ): void {
    const start = this.source.position(span[0]);
    const end = this.source.position(span[1]);
    this.found.push({
      start: span[0],
      diagnostic: {
        code,
        severity: 'error',
        file: this.file,
        path: this.formatPath(path),
        line: start.line,
        column: start.column,
        end_line: end.line,
        end_column: end.column,
        message,
        ...(suggestion === undefined ? {} : { suggestion }),
      },
    });
  }

  hasErrors(): boolean {
    return this.found.length > 0;
  }

  /** Every finding, in the order of the text. */
  diagnostics(): Diagnostic[] {
    return [...this.found]
      .sort((a, b) => a.start - b.start)
      .map((found) => found.diagnostic);
  }

  private formatPath(path: readonly Segment[]): string {
    return path.reduce<string>((joined, segment, index) => {
      if (typeof segment === 'string') {
        return joined === '' ? segment : `${joined}.${segment}`;
      }
      const stageName =
        path[index - 1] === 'stages' ? this.stageNames[segment] : undefined;
      return stageName === undefined
        ? `${joined}[${segment}]`
        : `${joined}.${stageName}`;
    }, '');
  }
}
