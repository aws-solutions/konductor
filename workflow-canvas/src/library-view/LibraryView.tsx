// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useState } from 'react';
import type { LibraryEntry } from '../api/types';
import type { NextPorts } from '../next-ui/next-http';

const FOLLOW_UP_REASON = 'Preview and copy are not available in this build.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'The workflow library did not load.';
}

function EntryCard({ entry }: { entry: LibraryEntry }) {
  const reason = entry.waits ?? FOLLOW_UP_REASON;
  const actions = (
    <SpaceBetween direction="horizontal" size="xs">
      <Button
        ariaLabel={`Open ${entry.title}`}
        disabled
        disabledReason={reason}
      >
        Open
      </Button>
      <Button
        ariaLabel={`Start from ${entry.title}`}
        variant="primary"
        disabled
        disabledReason={reason}
      >
        Start from
      </Button>
    </SpaceBetween>
  );
  return (
    <Container
      header={
        <Header variant="h2" actions={actions}>
          {entry.title}
        </Header>
      }
    >
      <SpaceBetween size="s">
        <Box>{entry.summary}</Box>
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Badge color={entry.status === 'ready' ? 'green' : 'grey'}>
            {entry.status === 'ready' ? 'Ready' : 'Planned'}
          </Badge>
          {entry.waits && <Box color="text-body-secondary">{entry.waits}</Box>}
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );
}

/** Lists shipped workflows and explains why actions are not yet available. */
export function LibraryView({ ports }: { ports: NextPorts }) {
  const [entries, setEntries] = useState<LibraryEntry[]>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void ports
      .listLibrary(controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setEntries(found);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(messageOf(error));
      });
    return () => controller.abort();
  }, [ports]);

  return (
    <Box padding={{ top: 'm' }}>
      <SpaceBetween size="m">
        <Header variant="h2">Workflow Library</Header>
        {failure && <Alert type="error">{failure}</Alert>}
        {!entries && !failure && (
          <StatusIndicator type="loading">Loading Library</StatusIndicator>
        )}
        {entries?.map((entry) => (
          <EntryCard key={entry.name} entry={entry} />
        ))}
      </SpaceBetween>
    </Box>
  );
}
