// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, useRef } from 'react';
import { endScrollTop, isAtEnd } from './follow-end';
import './code-pane.css';

/** One numbered line of text. */
export interface CodeLine {
  readonly n: number;
  readonly text: string;
}

/**
 * Numbered lines of plain text in a box that scrolls and takes keyboard
 * focus, so the arrow keys can scroll it. Text is rendered as text, never as
 * markup. The numbers are hidden from a screen reader, which reads the lines.
 * With `followEnd`, the box stays on its last line as lines arrive, until the
 * person scrolls up, and follows again once they scroll back to the bottom.
 * It jumps there with no animation, so it does not move against a reduced
 * motion setting.
 */
export function CodeLines({
  lines,
  label,
  describedBy,
  followEnd = false,
}: {
  lines: readonly CodeLine[];
  /** The name of the box for a screen reader. */
  label: string;
  /** The id of the element that says more about the box. */
  describedBy?: string;
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
          <li key={line.n} className="wf-code-line">
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
