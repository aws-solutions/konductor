import React from 'react';
import { ColumnLayout, Container, Header } from '@cloudscape-design/components';

interface Instance {
  id: string;
  type: string;
  state: string;
  launched: string;
}

export function DetailsPanel({ instance, fields }: { instance: Instance; fields: string[] }) {
  return (
    <Container header={<Header variant="h2">Details</Header>}>
      <ColumnLayout columns={fields.length}>
        <div>
          <div className="label">Instance ID</div>
          <div>{instance.id}</div>
        </div>
        <div>
          <div className="label">Type</div>
          <div>{instance.type}</div>
        </div>
        <div>
          <div className="label">State</div>
          <div>{instance.state}</div>
        </div>
        <div>
          <div className="label">Launched</div>
          <div>{instance.launched}</div>
        </div>
      </ColumnLayout>
    </Container>
  );
}
