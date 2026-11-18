// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import { CodeLines, type LineRange } from '../code-pane/CodeLines';
import { textLines } from './text-lines';

/** The lines of one stage of the file, to mark. */
export interface MarkedStage {
  readonly name: string;
  /** The `range` of the stage in the workflow view. */
  readonly range: LineRange;
}

function markText(stage: MarkedStage): string {
  const { line, end_line } = stage.range;
  return line === end_line
    ? `Line ${line} is stage ${stage.name}.`
    : `Lines ${line} to ${end_line} are stage ${stage.name}.`;
}

/**
 * The text of a workflow file, read-only, with line numbers. The lines of
 * `stage`, if given, are marked, and a note above the text says which they
 * are.
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
  return (
    <section className="wf-code-pane" aria-label={`Text of ${file}`}>
      <div className="wf-code-pane-head">
        <h3 className="wf-code-pane-title">{file}</h3>
        <p className="wf-code-note" id={noteId}>
          Read-only.{stage ? ` ${markText(stage)}` : ''}
        </p>
      </div>
      <CodeLines
        lines={textLines(text)}
        label={`Lines of ${file}`}
        describedBy={noteId}
        marked={stage?.range}
      />
    </section>
  );
}
