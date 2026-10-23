// SPDX-License-Identifier: Apache-2.0
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Tabs from '@cloudscape-design/components/tabs';

export function App() {
  return (
    <ContentLayout header={<Header variant="h1">Workflow canvas</Header>}>
      <Tabs
        tabs={[
          { id: 'designer', label: 'Designer', content: null },
          { id: 'execution', label: 'Execution', content: null },
        ]}
      />
    </ContentLayout>
  );
}
