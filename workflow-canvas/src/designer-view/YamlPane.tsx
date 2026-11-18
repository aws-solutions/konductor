// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import { CodeLines, type LineRange } from '../code-pane/CodeLines';
import { lineWindow } from './line-window';
import { textLines } from './text-lines';

/** The lines of one stage of the file, to mark. */
export interface MarkedStage {
  readonly name: string;
  /** The `range` of the stage in the workflow view. */
  readonly range: LineRange;
}

const count = (n: number) => n.toLocaleString('en-US');

function markText(stage: MarkedStage): string {
  const { line, end_line } = stage.range;
  return line === end_line
    ? `Line ${count(line)} is stage ${stage.name}.`
    : `Lines ${count(line)} to ${count(end_line)} are stage ${stage.name}.`;
}

function hiddenText(from: number, to: number): string {
  return from === to
    ? `Line ${count(from)} not shown.`
    : `Lines ${count(from)} to ${count(to)} not shown.`;
}

/**
 * The text of a workflow file, read-only, with line numbers. The lines of
 * `stage`, if given, are marked, and a note above the text says which they
 * are. A long file shows a window of its lines around the stage, or from the
 * top, and says which lines are left out before and after it.
 */
export function YamlPane({
  file,
  text,
  stage,
}: {
  /** The name of the file, such as `hello.yml`. */
  file: string;
  text: string;
  stage?: MarkedStage;
}) {
  const noteId = useId();
  const lines = textLines(text);
  const { first, last } = lineWindow(lines.length, stage?.range);
  const continues = stage !== undefined && stage.range.end_line > last;
  return (
    <section className="wf-code-pane" aria-label={`Text of ${file}`}>
      <div className="wf-code-pane-head">
        <h3 className="wf-code-pane-title">{file}</h3>
        <p className="wf-code-note" id={noteId}>
          Read-only.{stage ? ` ${markText(stage)}` : ''}
        </p>
      </div>
      {first > 1 && <p className="wf-code-note">{hiddenText(1, first - 1)}</p>}
      <CodeLines
        lines={lines.slice(first - 1, last)}
        label={`Lines of ${file}`}
        describedBy={noteId}
        marked={stage?.range}
      />
      {last < lines.length && (
        <p className="wf-code-note">
          {continues ? `Stage ${stage.name} continues. ` : ''}
          {hiddenText(last + 1, lines.length)}
        </p>
      )}
    </section>
  );
}
