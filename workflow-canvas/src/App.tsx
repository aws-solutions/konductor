// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Tabs from '@cloudscape-design/components/tabs';
import { Designer } from './designer/Designer';
import { useSettled } from './designer/use-settled';
import type { LoadResult } from './workflow/load-workflow';

const placeholder = <Box color="text-status-inactive">Nothing here yet.</Box>;

/**
 * Root component: the page title and the Designer and Execution tabs. The
 * Designer draws the workflow that `load` settles with; the Execution tab
 * shows a placeholder until its content is built.
 */
export function App({ load }: { load: Promise<LoadResult> }) {
  // Read here, not in the tab, so switching tabs does not load again.
  const result = useSettled(load);
  return (
    <AppLayout
      navigationHide
      toolsHide
      content={
        <ContentLayout header={<Header variant="h1">Workflow canvas</Header>}>
          <Tabs
            ariaLabel="Workflow canvas views"
            tabs={[
              {
                id: 'designer',
                label: 'Designer',
                content: <Designer result={result} />,
              },
              { id: 'execution', label: 'Execution', content: placeholder },
            ]}
          />
        </ContentLayout>
      }
    />
  );
}
