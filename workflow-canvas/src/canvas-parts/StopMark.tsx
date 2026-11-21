// SPDX-License-Identifier: Apache-2.0
import type { StopMarkState } from '../graph/leaf-stages';
import { stopMarkLabel } from './stop-mark';
import './stop-mark.css';

// Each state has its own shape, so it does not rest on colour alone.
function Glyph({ state }: { state: StopMarkState | undefined }) {
  switch (state) {
    case 'passed':
      return <path className="wf-stop-glyph" d="M4.5 8.5l2.5 2.5 4.5-5" />;
    case 'blocked':
      return <path className="wf-stop-glyph" d="M5 5l6 6M11 5l-6 6" />;
    case 'not-reached':
      return undefined;
    case undefined:
      return <rect className="wf-stop-core" x="6" y="6" width="4" height="4" />;
  }
}

/**
 * The stop mark of a leaf stage, a stage no other stage follows: where the
 * run ends. It shows `stopMarkState` once that stage's part of the run is
 * over, and its accessible name says so. It is an image, not a live region:
 * the run status is announced elsewhere.
 */
export function StopMark({
  stage,
  state,
}: {
  /** The name of the leaf stage. */
  stage: string;
  state: StopMarkState | undefined;
}) {
  return (
    <span
      className="wf-stop"
      data-state={state ?? 'open'}
      role="img"
      aria-label={stopMarkLabel(stage, state)}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect
          className="wf-stop-frame"
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
        />
        <Glyph state={state} />
      </svg>
    </span>
  );
}
