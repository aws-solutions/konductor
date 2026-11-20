// SPDX-License-Identifier: Apache-2.0
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CodeLines, type LineRange } from '../code-pane/CodeLines';
import {
  lineWindow,
  newlyShown,
  shiftWindow,
  type LineWindow,
} from './line-window';
import { scrollTopFor } from './scroll-to-row';
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

function showText({ first, last }: LineWindow): string {
  return first === last
    ? `Show line ${count(first)}`
    : `Show lines ${count(first)} to ${count(last)}`;
}

type Direction = -1 | 1;

// The window the person moved to. It is kept only while `from` is the same:
// the file, its line count, and the stage and its range. The box of lines is
// keyed on it too, so another file or stage starts scrolled to its top.
interface Moved {
  readonly from: string;
  readonly window: LineWindow;
}

/**
 * The text of a workflow file, read-only, with line numbers. The lines of
 * `stage`, if given, are marked, and a note above the text says which they
 * are. A long file shows a window of its lines around the stage, or from the
 * top, with a button before and after it that shows the next lines that way.
 * After a move forward the box shows the first newly shown line at its top,
 * and after a move back the last one at its bottom, with no smooth scroll.
 * The focus stays on that button, or goes to the first newly shown line when
 * the button is gone, without scrolling the box again.
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
  const total = lines.length;
  const start = lineWindow(total, stage?.range);
  const from = JSON.stringify([
    file,
    total,
    stage?.name,
    stage?.range.line,
    stage?.range.end_line,
  ]);
  const [moved, setMoved] = useState<Moved | undefined>();
  const window = moved?.from === from ? moved.window : start;
  const { first, last } = window;
  const before = newlyShown(window, total, -1);
  const after = newlyShown(window, total, 1);
  const continues = stage !== undefined && stage.range.end_line > last;

  const section = useRef<HTMLElement>(null);
  const buttons = useRef<Record<Direction, ButtonProps.Ref | null>>({
    [-1]: null,
    1: null,
  });
  const afterMove = useRef<
    { direction: Direction; shown: LineWindow } | undefined
  >(undefined);
  useLayoutEffect(() => {
    const pending = afterMove.current;
    if (!pending) return;
    afterMove.current = undefined;
    const { direction, shown } = pending;
    const box = section.current?.querySelector('.wf-code-scroll');
    const rows = section.current?.querySelectorAll('li');
    const edge = direction === 1 ? shown.first : shown.last;
    const target = rows?.[edge - first];
    if (box instanceof HTMLElement && target instanceof HTMLElement) {
      box.scrollTop = scrollTopFor(
        box.getBoundingClientRect(),
        target.getBoundingClientRect(),
        box.scrollTop,
        direction === 1 ? 'top' : 'bottom',
      );
    }
    const button = buttons.current[direction];
    if (button) {
      button.focus();
      return;
    }
    const row = rows?.[shown.first - first];
    if (row instanceof HTMLElement) {
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
    }
  });

  function move(direction: Direction, shown: LineWindow) {
    afterMove.current = { direction, shown };
    setMoved({ from, window: shiftWindow(window, total, direction) });
  }

  const showButton = (direction: Direction, shown: LineWindow) => (
    <Button
      variant="inline-link"
      ref={(button) => {
        buttons.current[direction] = button;
      }}
      onClick={() => move(direction, shown)}
    >
      {showText(shown)}
    </Button>
  );
  return (
    <section
      ref={section}
      className="wf-code-pane"
      aria-label={`Text of ${file}`}
    >
      <div className="wf-code-pane-head">
        <h3 className="wf-code-pane-title">{file}</h3>
        <p className="wf-code-note" id={noteId}>
          Read-only.{stage ? ` ${markText(stage)}` : ''}
        </p>
      </div>
      {before && <p className="wf-code-note">{showButton(-1, before)}</p>}
      <CodeLines
        key={from}
        lines={lines.slice(first - 1, last)}
        label={`Lines of ${file}`}
        describedBy={noteId}
        marked={stage?.range}
      />
      {after && (
        <p className="wf-code-note">
          {continues ? `Stage ${stage.name} continues. ` : ''}
          {showButton(1, after)}
        </p>
      )}
    </section>
  );
}
