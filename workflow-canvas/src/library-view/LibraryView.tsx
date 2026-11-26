// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError } from '../api/api';
import type { LibraryEntry, WorkflowDocument } from '../api/types';
import { DesignView } from '../design-view/DesignView';
import type { Scheduler } from '../execution/core';
import { timerScheduler } from '../execution/timer-scheduler';
import { COPY_UNCERTAIN_CODE, type NextPorts } from '../next-ui/next-http';
import { useEditor } from '../designer/use-editor';
import type { LoadedWorkflow } from '../workflow/load-workflow';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : fallback;
}

function copyNameOf(entry: LibraryEntry): string {
  const bare = entry.name.slice('library/'.length);
  return `${bare.slice(0, 59)}-copy`;
}

function EntryCard({
  entry,
  onOpen,
  onStart,
  openRef,
}: {
  entry: LibraryEntry;
  onOpen: () => void;
  onStart: () => void;
  openRef: (button: ButtonProps.Ref | null) => void;
}) {
  const planned = entry.status === 'planned';
  const actions = (
    <SpaceBetween direction="horizontal" size="xs">
      <Button
        ref={openRef}
        ariaLabel={`Open ${entry.title}`}
        disabled={planned}
        disabledReason={entry.waits}
        onClick={onOpen}
      >
        Open
      </Button>
      <Button
        ariaLabel={`Start from ${entry.title}`}
        variant="primary"
        disabled={planned}
        disabledReason={entry.waits}
        onClick={onStart}
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

function LibraryPreview({
  document,
  workflow,
  ports,
  agents,
  scheduler,
}: {
  document: WorkflowDocument;
  workflow: LoadedWorkflow;
  ports: NextPorts;
  agents: readonly { readonly id: string; readonly summary: string }[];
  scheduler: Scheduler;
}) {
  const loaded = useMemo(
    () => ({ ...workflow, document }),
    [workflow, document],
  );
  const editor = useEditor(loaded, scheduler);
  const validate = useCallback(
    (request: { name?: string; text: string }, signal: AbortSignal) =>
      ports.validate({ ...request, name: workflow.document.name }, signal),
    [ports, workflow.document.name],
  );
  if (!editor) return null;
  return (
    <DesignView
      editor={editor}
      loaded={loaded}
      harness={workflow.harness}
      validate={validate}
      scheduler={scheduler}
      stageFields={{ agent: document.stageFields.agent }}
      agents={agents}
    />
  );
}

type LibraryState =
  | { ports: NextPorts; phase: 'loading' }
  | { ports: NextPorts; phase: 'loaded'; entries: LibraryEntry[] }
  | { ports: NextPorts; phase: 'failed'; message: string };

/** Lists shipped workflows, previews ready entries read-only, and copies one into the workflow folder. */
export function LibraryView({
  ports,
  workflow,
  agents,
  onCopy,
  onCopyUncertain,
  onAnnounce,
  beforeCopy = () => true,
  scheduler = timerScheduler,
}: {
  ports: NextPorts;
  workflow: LoadedWorkflow;
  agents: readonly { readonly id: string; readonly summary: string }[];
  onCopy: (document: WorkflowDocument) => void;
  onCopyUncertain: (message: string) => void;
  onAnnounce: (message: string) => void;
  beforeCopy?: () => boolean;
  scheduler?: Scheduler;
}) {
  const [read, setRead] = useState<LibraryState>();
  const list: LibraryState =
    read?.ports === ports ? read : { ports, phase: 'loading' };
  const [opened, setOpened] = useState<{
    entry: LibraryEntry;
    document?: WorkflowDocument;
    failure?: string;
  }>();
  const [copying, setCopying] = useState<LibraryEntry>();
  const [copyName, setCopyName] = useState('');
  const [copyFailure, setCopyFailure] = useState<string>();
  const [saving, setSaving] = useState(false);
  const detailRequest = useRef<AbortController | undefined>(undefined);
  const copyRequest = useRef(false);
  const backButton = useRef<ButtonProps.Ref>(null);
  const entryButtons = useRef(new Map<string, ButtonProps.Ref>());
  const restoreFocus = useRef<string | undefined>(undefined);

  useEffect(() => () => detailRequest.current?.abort(), []);
  useLayoutEffect(() => {
    if (opened) backButton.current?.focus();
    else if (restoreFocus.current) {
      entryButtons.current.get(restoreFocus.current)?.focus();
      restoreFocus.current = undefined;
    }
  }, [opened?.entry.name]);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ ports, phase: 'loading' });
    void ports
      .listLibrary(controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) {
          setRead({ ports, phase: 'loaded', entries });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRead({
            ports,
            phase: 'failed',
            message: messageOf(error, 'The workflow library did not load.'),
          });
        }
      });
    return () => controller.abort();
  }, [ports]);

  const open = useCallback(
    (entry: LibraryEntry) => {
      detailRequest.current?.abort();
      const controller = new AbortController();
      detailRequest.current = controller;
      setOpened({ entry });
      void ports
        .getLibrary(entry.name, controller.signal)
        .then((document) => {
          if (controller.signal.aborted) return;
          setOpened({ entry, document });
          onAnnounce(`${entry.title} opened read-only.`);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setOpened({
            entry,
            failure: messageOf(error, 'The library workflow did not load.'),
          });
        })
        .finally(() => {
          if (detailRequest.current === controller)
            detailRequest.current = undefined;
        });
    },
    [onAnnounce, ports],
  );

  const startFrom = useCallback((entry: LibraryEntry) => {
    setCopying(entry);
    setCopyName(copyNameOf(entry));
    setCopyFailure(undefined);
  }, []);
  const nameError =
    copyName === ''
      ? 'Enter a workflow name.'
      : NAME_PATTERN.test(copyName)
        ? undefined
        : 'Use 1 to 64 lowercase letters, numbers, or hyphens, starting with a letter or number.';
  function createCopy() {
    if (!copying || nameError || copyRequest.current || !beforeCopy()) return;
    copyRequest.current = true;
    setSaving(true);
    setCopyFailure(undefined);
    void ports
      .copyLibrary(copying.name, copyName)
      .then((document) => {
        setCopying(undefined);
        onAnnounce(`${copyName} created and opened.`);
        onCopy(document);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === COPY_UNCERTAIN_CODE) {
          onCopyUncertain(error.message);
        } else {
          setCopyFailure(messageOf(error, 'The workflow was not copied.'));
        }
      })
      .finally(() => {
        copyRequest.current = false;
        setSaving(false);
      });
  }

  function backToList() {
    detailRequest.current?.abort();
    detailRequest.current = undefined;
    restoreFocus.current = opened?.entry.name;
    setOpened(undefined);
    onAnnounce('Library list opened.');
  }

  return (
    <Box padding={{ top: 'm' }}>
      <SpaceBetween size="m">
        {opened ? (
          <SpaceBetween size="m">
            <Header
              variant="h2"
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button ref={backButton} onClick={backToList}>
                    Back to Library
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => startFrom(opened.entry)}
                  >
                    Start from
                  </Button>
                </SpaceBetween>
              }
            >
              {opened.entry.title}
            </Header>
            {opened.failure && <Alert type="error">{opened.failure}</Alert>}
            {!opened.document && !opened.failure && (
              <StatusIndicator type="loading">Opening workflow</StatusIndicator>
            )}
            {opened.document && (
              <LibraryPreview
                document={opened.document}
                workflow={workflow}
                ports={ports}
                agents={agents}
                scheduler={scheduler}
              />
            )}
          </SpaceBetween>
        ) : (
          <SpaceBetween size="m">
            <Header variant="h2">Workflow Library</Header>
            {list.phase === 'failed' && (
              <Alert type="error">{list.message}</Alert>
            )}
            {list.phase === 'loading' && (
              <StatusIndicator type="loading">Loading Library</StatusIndicator>
            )}
            {list.phase === 'loaded' && list.entries.length === 0 && (
              <Box color="text-status-inactive">
                No shipped workflows are available.
              </Box>
            )}
            {list.phase === 'loaded' &&
              list.entries.map((entry) => (
                <EntryCard
                  key={entry.name}
                  entry={entry}
                  onOpen={() => open(entry)}
                  onStart={() => startFrom(entry)}
                  openRef={(button) => {
                    if (button) entryButtons.current.set(entry.name, button);
                    else entryButtons.current.delete(entry.name);
                  }}
                />
              ))}
          </SpaceBetween>
        )}
        <Modal
          visible={copying !== undefined}
          onDismiss={() => !saving && setCopying(undefined)}
          closeAriaLabel="Close the dialog"
          header="Start from this workflow"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={saving} onClick={() => setCopying(undefined)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={nameError !== undefined}
                  onClick={createCopy}
                >
                  Create copy
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            {copyFailure && <Alert type="error">{copyFailure}</Alert>}
            <FormField label="Workflow name" errorText={nameError}>
              <Input
                value={copyName}
                disabled={saving}
                onChange={({ detail }) => setCopyName(detail.value)}
              />
            </FormField>
          </SpaceBetween>
        </Modal>
      </SpaceBetween>
    </Box>
  );
}
