// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import Alert from '@cloudscape-design/components/alert';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Breadcrumbs } from './chrome/Breadcrumbs';
import './chrome/chrome.css';
import { ModePanels, ModeSwitch, type PageView } from './chrome/ModeSwitch';
import { TOP_BAR_ID, TopBar } from './chrome/TopBar';
import { DesignView } from './design-view/DesignView';
import { isDirty } from './designer/core';
import { useEditor } from './designer/use-editor';
import { useLeaveGuard } from './designer/use-leave-guard';
import { useSettled } from './designer/use-settled';
import {
  reasonSentence,
  type RunMemory,
  type Scheduler,
} from './execution/core';
import { timerScheduler } from './execution/timer-scheduler';
import type { SwapRisk } from './launch/swap-guard';
import { LibraryView } from './library-view/LibraryView';
import type { NextPorts } from './next-ui/next-http';
import { NextRunAnnouncements } from './next-ui/NextRunAnnouncements';
import { oneCheck } from './next-ui/one-check';
import { useNextData, type NextData } from './next-ui/use-next-data';
import { PARAMS_LOADING, type ParamsState } from './run-view/run-params';
import { RunView } from './run-view/RunView';
import {
  useRunController,
  type RunViewPorts,
} from './run-view/use-run-controller';
import { useThemeMode } from './theme/use-theme-mode';
import {
  openWorkflowName,
  withDocument,
  type LoadedWorkflow,
  type LoadResult,
} from './workflow/load-workflow';
import { WorkflowGate } from './workflow/WorkflowGate';

type ViewId = 'designer' | 'execution' | 'library';

/** The page views, by the labels the switch shows, before any can draw. */
const LOADING_VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: 'designer', label: 'Design' },
  { id: 'execution', label: 'Run' },
  { id: 'library', label: 'Library' },
];

const ACTIVE_RUN_COPY_REASON = 'A run is already active in this workspace.';

// The calls of a page that has no session to run anything through. It is one
// object for the life of the page, so the run controller holds one state for
// as long as there is nothing to follow.
const NO_RUN_PORTS: RunViewPorts = {
  start: () =>
    Promise.reject(new Error('The page has no session to start a run with.')),
  readEvents: undefined,
  listRuns: undefined,
  readChecks: undefined,
  scheduler: timerScheduler,
  now: () => Date.now(),
};

/** What the page knows about the workflow's declared params. */
function paramsState(next: NextData): ParamsState {
  if (next.failure !== undefined) {
    return { kind: 'failed', reason: next.failure };
  }
  if (!next.ready) return PARAMS_LOADING;
  return { kind: 'ready', declared: next.extras.params ?? [] };
}

/** Failures from the independent workflow-fields and agent-list reads. */
function dataFailures(next: NextData): readonly string[] {
  return [next.failure, next.agentsFailure].filter(
    (reason): reason is string => reason !== undefined,
  );
}

/**
 * Root component: the top bar, then the page header (breadcrumbs, the name of
 * the workflow as the title, and the Design, Run and Library switch), then
 * the selected view. Design and Run use the loaded workflow, while Library
 * lists shipped workflows through the same session.
 *
 * `nextPortsFor` gives the views the calls they need beyond the session's
 * own. The page, not the view that draws it, follows a run, so a change of
 * view does not stop the only follower, and the run drives the swap guard
 * and the live region.
 */
export function App({
  load,
  notice,
  scheduler = timerScheduler,
  runMemory,
  swapRisk,
  nextPortsFor,
}: {
  load: Promise<LoadResult>;
  /** Shown above the view, such as the refusal of a pasted launch address. */
  notice?: ReactNode;
  scheduler?: Scheduler;
  /** Keeps the latest run across a reload; a page without it starts afresh. */
  runMemory?: RunMemory;
  /** Told what another workflow would take from the page. */
  swapRisk?: SwapRisk;
  /**
   * Builds the calls the views make for the workflow that has just loaded.
   * It is called once per load, with that workflow, so each one has its own
   * calls and they address the session it was loaded with.
   */
  nextPortsFor: (workflow: LoadedWorkflow) => NextPorts;
}) {
  // Read here, not in a view, so switching views does not load again.
  const result = useSettled(load);
  const source = result?.ok ? result.workflow : undefined;
  const [copied, setCopied] = useState<{
    source: LoadedWorkflow;
    document: LoadedWorkflow['document'];
  }>();
  const displayed = useMemo(
    () =>
      source && copied?.source === source
        ? withDocument(result, copied.document)
        : result,
    [copied, result, source],
  );
  // The calls of the views belong to the workflow that loaded, so each load
  // gets its own; the hooks of those views tell workflows apart by them.
  const nextPorts = useMemo(
    () => (result?.ok ? nextPortsFor(result.workflow) : undefined),
    [result, nextPortsFor],
  );
  const [mode, toggleMode] = useThemeMode();
  // The load the page draws, held by its identity as well as its content: the
  // editor is opened with it, and the views that keep anything of their own
  // tell one workflow from another by it.
  const opened = displayed?.ok ? displayed.workflow : undefined;
  // One check of a text for the two readers of it: the editor, which judges
  // the draft by its findings, and the Design view, which draws the keys and
  // the lines of each stage. Both ask after the same pause, so without this
  // one edit would send two of the same request.
  const checks = useMemo(
    () =>
      nextPorts && opened
        ? oneCheck(nextPorts.validate, opened.document.name)
        : undefined,
    [nextPorts, opened],
  );
  // The editor checks the draft through that one call.
  const loaded = useMemo(
    () =>
      opened && checks
        ? { ...opened, edits: { ...opened.edits, check: checks.check } }
        : opened,
    [opened, checks],
  );
  // The Design view edits a draft; a run uses the file as it is saved.
  const editor = useEditor(loaded, scheduler);
  const unsaved = editor ? isDirty(editor.state) : false;
  // The draft lives in the page, so leaving the page loses the changes.
  useLeaveGuard(unsaved, window);
  // One object until the saved file changes, as the view draws a new canvas
  // for each new result.
  const document = editor?.state.saved;
  const saved = useMemo(
    () => (document ? withDocument(displayed, document) : displayed),
    [displayed, document],
  );
  const [view, setView] = useState<ViewId>('designer');
  const [copyBlocked, setCopyBlocked] = useState<string>();
  const [libraryAnnouncement, setLibraryAnnouncement] = useState('');
  const workflowName = openWorkflowName(saved);
  const next = useNextData({
    ports: nextPorts,
    reload: document?.hash,
  });
  const runs = opened?.runs;
  const stageNames = useMemo(
    () =>
      (saved?.ok ? (saved.workflow.document.view?.stages ?? []) : []).map(
        (stage) => stage.name,
      ),
    [saved],
  );
  // The calls the Run view follows a run through, which belong to the
  // workflow that loaded: another workflow is another object, and the
  // controller starts again for it, the run its session kept included.
  const nextRunPorts = useMemo(
    () =>
      nextPorts && runs && workflowName
        ? {
            start: (params, signal) =>
              nextPorts.startRun(workflowName, params, signal),
            readEvents: nextPorts.readEvents,
            listRuns: (signal) => nextPorts.listRuns(signal),
            readChecks: nextPorts.readChecks,
            scheduler,
            now: () => Date.now(),
          }
        : NO_RUN_PORTS,
    [nextPorts, opened, runs, scheduler, workflowName],
  );
  // The page follows the run, not the view that draws it: a person who looks
  // at Design must not take the only follower off the page.
  const nextRunner = useRunController({
    stages: stageNames,
    ...(next.extras.goalDefault === undefined
      ? {}
      : { goalDefault: next.extras.goalDefault }),
    params: paramsState(next),
    ...(next.extras.checks === undefined
      ? {}
      : { declaredChecks: next.extras.checks }),
    ports: nextRunPorts,
    // Only once there is a session: the page has no run of its own to keep
    // before one, and the controller drops the run of the session it is
    // handed a new one in place of.
    ...(runMemory && nextRunPorts !== NO_RUN_PORTS ? { runMemory } : {}),
  });
  const nextRun = nextRunner.lifecycle;
  const workflowViews: PageView<ViewId>[] =
    editor && nextPorts && runs && loaded && checks && source
      ? [
          {
            id: 'designer',
            label: 'Design',
            content: (
              <DesignView
                editor={editor}
                loaded={loaded}
                harness={loaded.harness}
                validate={checks.validate}
                scheduler={scheduler}
                stageFields={next.extras.stageFields}
                agents={next.agents}
              />
            ),
          },
          {
            id: 'execution',
            label: 'Run',
            content: (
              <RunView
                controller={nextRunner}
                reasonSentence={reasonSentence}
                unsaved={unsaved}
                {...(workflowName === undefined ? {} : { workflowName })}
              />
            ),
          },
        ]
      : LOADING_VIEWS.filter((candidate) => candidate.id !== 'library').map(
          (candidate) => ({
            ...candidate,
            content: <WorkflowGate result={result}>{() => null}</WorkflowGate>,
          }),
        );
  const libraryView: PageView<ViewId> = {
    id: 'library',
    label: 'Library',
    content:
      nextPorts && loaded && source ? (
        <LibraryView
          ports={nextPorts}
          workflow={loaded}
          agents={next.agents}
          scheduler={scheduler}
          copyDisabledReason={
            nextRun.active ? ACTIVE_RUN_COPY_REASON : undefined
          }
          beforeCopy={() =>
            !unsaved ||
            window.confirm('Opening the copy drops unsaved changes. Continue?')
          }
          onAnnounce={setLibraryAnnouncement}
          onCopyUncertain={(message) => {
            setCopyBlocked(message);
            setView('designer');
          }}
          onCopy={(copiedDocument) => {
            setCopied({ source, document: copiedDocument });
            setView('designer');
          }}
        />
      ) : (
        <WorkflowGate result={result}>{() => null}</WorkflowGate>
      ),
  };
  const views: PageView<ViewId>[] = copyBlocked
    ? LOADING_VIEWS.map((blockedView) => ({
        ...blockedView,
        content: (
          <Alert type="error" header="Reload the page">
            {copyBlocked}
          </Alert>
        ),
      }))
    : [...workflowViews, libraryView];
  useEffect(
    () => swapRisk?.set({ draft: unsaved, run: nextRun.active }),
    [swapRisk, unsaved, nextRun.active],
  );
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
            breadcrumbs={<Breadcrumbs workflowName={workflowName} />}
            header={
              <Header
                variant="h1"
                actions={
                  <ModeSwitch
                    ariaLabel="Workflow canvas views"
                    views={views}
                    active={view}
                    focusRequest={copyBlocked ? 2 : copied ? 1 : 0}
                    onChange={(nextView) => {
                      setLibraryAnnouncement('');
                      setView(nextView);
                    }}
                  />
                }
              >
                {workflowName ?? 'Workflow canvas'}
              </Header>
            }
          >
            {notice}
            {dataFailures(next).map((reason) => (
              <Alert key={reason} type="warning" data-testid="next-data-error">
                {reason}
              </Alert>
            ))}
            <NextRunAnnouncements
              run={nextRun}
              reasonSentence={reasonSentence}
              announcement={libraryAnnouncement}
            />
            <ModePanels views={views} active={view} />
          </ContentLayout>
        }
      />
    </>
  );
}
