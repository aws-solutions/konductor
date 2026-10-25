// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Tabs from '@cloudscape-design/components/tabs';
import type { ReactNode } from 'react';
import { Breadcrumbs } from './chrome/Breadcrumbs';
import './chrome/chrome.css';
import { TOP_BAR_ID, TopBar } from './chrome/TopBar';
import { Designer } from './designer/Designer';
import { useSettled } from './designer/use-settled';
import { TAB_STRIP_STYLE } from './theme/tokens';
import { useThemeMode } from './theme/use-theme-mode';
import { openWorkflowName, type LoadResult } from './workflow/load-workflow';

const placeholder = <Box color="text-status-inactive">Nothing here yet.</Box>;

/**
 * Root component: the top bar, then the page header (breadcrumbs and title)
 * with the Designer and Execution tabs. The Designer draws the workflow that
 * `load` settles with; the Execution tab shows a placeholder until its
 * content is built.
 */
export function App({
  load,
  notice,
}: {
  load: Promise<LoadResult>;
  /** Shown above the tabs, such as the refusal of a pasted launch address. */
  notice?: ReactNode;
}) {
  // Read here, not in the tab, so switching tabs does not load again.
  const result = useSettled(load);
  const [mode, toggleMode] = useThemeMode();
  return (
    <>
      <TopBar mode={mode} onToggle={toggleMode} />
      <AppLayout
        headerSelector={`#${TOP_BAR_ID}`}
        disableContentPaddings
        maxContentWidth={Number.MAX_VALUE}
        navigationHide
        toolsHide
        content={
          <ContentLayout
            defaultPadding
            headerVariant="high-contrast"
            breadcrumbs={
              <Breadcrumbs workflowName={openWorkflowName(result)} />
            }
            header={<Header variant="h1">Workflow canvas</Header>}
          >
            {notice}
            <div className="wf-tab-strip">
              <Tabs
                ariaLabel="Workflow canvas views"
                style={TAB_STRIP_STYLE}
                tabs={[
                  {
                    id: 'designer',
                    label: 'Designer',
                    content: <Designer result={result} />,
                  },
                  { id: 'execution', label: 'Execution', content: placeholder },
                ]}
              />
            </div>
          </ContentLayout>
        }
      />
    </>
  );
}
