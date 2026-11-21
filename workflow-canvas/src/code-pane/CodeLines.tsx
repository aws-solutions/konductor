// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, useRef } from 'react';
import { endScrollTop, isAtEnd } from './follow-end';
import './code-pane.css';

/** One numbered line of text. */
export interface CodeLine {
  readonly n: number;
  readonly text: string;
}

/** The lines from `line` to `end_line`, both included, as the API gives them. */
export interface LineRange {
  readonly line: number;
  readonly end_line: number;
}

function isMarked(n: number, range: LineRange | undefined): boolean {
  return range !== undefined && n >= range.line && n <= range.end_line;
}

/**
 * Numbered lines of plain text in a box that scrolls and takes keyboard
 * focus, so the arrow keys can scroll it. Text is rendered as text, never as
 * markup. The numbers are hidden from a screen reader, which reads the lines.
 * The lines of `marked` are drawn as marked. Only the first carries
 * `aria-current`, as one item of a list is current; the caller says which
 * lines the range holds in the note that `describedBy` names.
 * With `followEnd`, the box stays on its last line as lines arrive, until the
 * person scrolls up, and follows again once they scroll back to the bottom.
 * It jumps there with no animation, so it does not move against a reduced
 * motion setting.
 */
export function CodeLines({
  lines,
  label,
  describedBy,
  marked,
  followEnd = false,
}: {
  lines: readonly CodeLine[];
  /** The name of the box for a screen reader. */
  label: string;
  /** The id of the element that says more about the box. */
  describedBy?: string;
  marked?: LineRange;
  /** Keep the box on its last line while the person has not scrolled up. */
  followEnd?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const element = box.current;
    if (followEnd && element && following.current) {
      element.scrollTop = endScrollTop(element);
    }
  }, [followEnd, lines]);
  return (
    <div
      ref={box}
      onScroll={(event) => {
        following.current = isAtEnd(event.currentTarget);
      }}
      className="wf-code-scroll"
      role="region"
      tabIndex={0}
      aria-label={label}
      aria-describedby={describedBy}
    >
      <ol className="wf-code-lines">
        {lines.map((line) => (
          <li
            key={line.n}
            className="wf-code-line"
            data-marked={isMarked(line.n, marked) ? 'true' : undefined}
            aria-current={line.n === marked?.line ? 'true' : undefined}
          >
            <span className="wf-code-n" aria-hidden="true">
              {line.n}
            </span>
            <span className="wf-code-text">{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
