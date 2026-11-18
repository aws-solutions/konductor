// SPDX-License-Identifier: Apache-2.0
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
 */
export function CodeLines({
  lines,
  label,
  describedBy,
  marked,
}: {
  lines: readonly CodeLine[];
  /** The name of the box for a screen reader. */
  label: string;
  /** The id of the element that says more about the box. */
  describedBy?: string;
  marked?: LineRange;
}) {
  return (
    <div
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
