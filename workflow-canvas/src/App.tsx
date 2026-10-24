// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Tabs from '@cloudscape-design/components/tabs';

const placeholder = <Box color="text-status-inactive">Nothing here yet.</Box>;

export function App() {
  return (
    <AppLayout
      navigationHide
      toolsHide
      content={
        <ContentLayout header={<Header variant="h1">Workflow canvas</Header>}>
          <Tabs
            ariaLabel="Workflow canvas views"
            tabs={[
              { id: 'designer', label: 'Designer', content: placeholder },
              { id: 'execution', label: 'Execution', content: placeholder },
            ]}
          />
        </ContentLayout>
      }
    />
  );
}
