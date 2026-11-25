// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import './code-pane.css';

/**
 * A box the whole text of a file can be typed into, in the same face and
 * colours as the numbered lines beside it. The value of a `textarea` is
 * text, never markup, so nothing in the file can be rendered. It has no line
 * numbers: a text being typed has no stable lines to number, and the browser
 * owns the caret, the selection and the scrolling.
 */
export function CodeText({
  text,
  label,
  describedBy,
  disabled = false,
  onChange,
}: {
  text: string;
  /** The name of the box for a screen reader. */
  label: string;
  /** The id of the element that says more about the box. */
  describedBy?: string;
  /** Shown but not editable, as while the file is being loaded again. */
  disabled?: boolean;
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
        disabled={disabled}
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
