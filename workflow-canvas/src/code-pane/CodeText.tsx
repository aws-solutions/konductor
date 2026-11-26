// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import './code-pane.css';

/**
 * A box the whole text of a file can be typed into, in the same face and
 * colours as the numbered lines beside it. The value of a `textarea` is
 * text, never markup, so nothing in the file can be rendered. It has no line
 * numbers: a text being typed has no stable lines to number, and the browser
 * owns the caret, the selection and the scrolling.
 *
 * With `readOnly` the text stays reachable: the box keeps its place in the
 * tab order, so it can be focused, read, selected and copied, and only
 * typing is refused. `describedBy` is where the reason is said.
 */
export function CodeText({
  text,
  label,
  describedBy,
  readOnly = false,
  onChange,
}: {
  text: string;
  /** The name of the box for a screen reader. */
  label: string;
  /** The id of the element that says more about the box. */
  describedBy?: string;
  /** Shown and readable but not editable, as while a save is going on. */
  readOnly?: boolean;
  onChange: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className="wf-code-scroll wf-code-area-box">
      <label className="wf-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="wf-code-area"
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-describedby={describedBy}
        data-testid="yaml-text"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
