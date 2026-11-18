// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import { CodeLines } from '../code-pane/CodeLines';
import type { ConsoleLine } from './core/run-follow';

// The lines before the first one held. The cap of the buffer and the server's
// own cap both drop the oldest lines, so the first number says how many.
function droppedText(lines: readonly ConsoleLine[]): string | undefined {
  const dropped = (lines[0]?.n ?? 1) - 1;
  if (dropped <= 0) return undefined;
  return dropped === 1
    ? '1 earlier line is not shown.'
    : `${dropped} earlier lines are not shown.`;
}

/**
 * The console lines of one stage, read-only. The lines are live only: the
 * server keeps none once the run ends, and the page saves none, which the
 * pane says.
 */
export function ConsolePane({
  stage,
  lines,
}: {
  stage: string;
  /** The stage's lines, oldest first, as `applyRunEvents` keeps them. */
  lines: readonly ConsoleLine[];
}) {
  const noteId = useId();
  const dropped = droppedText(lines);
  return (
    <section className="wf-code-pane" aria-label={`Console of ${stage}`}>
      <div className="wf-code-pane-head">
        <h3 className="wf-code-pane-title">Console: {stage}</h3>
        <p className="wf-code-note" id={noteId}>
          Live only, not saved.
        </p>
      </div>
      {dropped && <p className="wf-code-note">{dropped}</p>}
      {lines.length === 0 ? (
        <p className="wf-code-note">No output yet.</p>
      ) : (
        <CodeLines
          lines={lines}
          label={`Console lines of ${stage}`}
          describedBy={noteId}
        />
      )}
    </section>
  );
}
