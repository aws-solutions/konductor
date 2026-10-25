// SPDX-License-Identifier: Apache-2.0
import TopNavigation from '@cloudscape-design/components/top-navigation';
import { otherMode } from '../theme/mode';
import { LOGO_DATA_URI, type ThemeMode } from '../theme/tokens';

/** The id of the top bar, which the page layout reads to sit below it. */
export const TOP_BAR_ID = 'wf-top-bar';

/**
 * The bar across the top: the logo and the page name, and the button that
 * switches between the light and the dark mode. The accessible name of the
 * button starts with its visible text.
 */
export function TopBar({
  mode,
  onToggle,
}: {
  mode: ThemeMode;
  onToggle: () => void;
}) {
  return (
    <div id={TOP_BAR_ID}>
      <TopNavigation
        identity={{
          href: '#',
          onFollow: (event) => event.preventDefault(),
          title: 'Workflow canvas',
          logo: { src: LOGO_DATA_URI, alt: 'Konductor' },
        }}
        utilities={[
          {
            type: 'button',
            text: `Theme: ${mode}`,
            ariaLabel: `Theme: ${mode}. Switch to ${otherMode(mode)}`,
            onClick: onToggle,
          },
        ]}
      />
    </div>
  );
}
