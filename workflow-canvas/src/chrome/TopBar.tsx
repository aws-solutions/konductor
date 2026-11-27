// SPDX-License-Identifier: Apache-2.0
import { otherMode } from '../theme/mode';
import { LOGO_DATA_URI, type ThemeMode } from '../theme/tokens';
import { viewTabId } from './ModeSwitch';

/** The id of the top bar, which the page layout reads to sit below it. */
export const TOP_BAR_ID = 'wf-top-bar';

/** A place in the workflow shell. */
export type ShellPlace = 'library' | 'canvas';

/** The product bar with its two places and theme control. */
export function TopBar({
  mode,
  place,
  onPlace,
  onToggle,
}: {
  mode: ThemeMode;
  place: ShellPlace;
  onPlace: (place: ShellPlace) => void;
  onToggle: () => void;
}) {
  return (
    <header id={TOP_BAR_ID} className="wf-top-bar">
      <div className="wf-brand">
        <img src={LOGO_DATA_URI} alt="" />
        <span>Konductor</span>
      </div>
      <nav className="wf-places" aria-label="Places">
        <button
          type="button"
          id={viewTabId('library')}
          aria-current={place === 'library' ? 'page' : undefined}
          onClick={() => onPlace('library')}
        >
          Library
        </button>
        <button
          type="button"
          aria-current={place === 'canvas' ? 'page' : undefined}
          onClick={() => onPlace('canvas')}
        >
          Canvas
        </button>
      </nav>
      <button
        type="button"
        className="wf-theme-toggle"
        aria-label={`Theme: ${mode}. Switch to ${otherMode(mode)}`}
        onClick={onToggle}
      >
        Theme: {mode}
      </button>
    </header>
  );
}
