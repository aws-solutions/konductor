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
import { Designer } from './designer/Designer';
import { isDirty } from './designer/core';
import { useEditor } from './designer/use-editor';
import { useLeaveGuard } from './designer/use-leave-guard';
import { useSettled } from './designer/use-settled';
import { isInFlight, type RunMemory, type Scheduler } from './execution/core';
import { Execution } from './execution/Execution';
import { RunAnnouncements } from './execution/RunAnnouncements';
import { timerScheduler } from './execution/timer-scheduler';
import { useExecution } from './execution/use-execution';
import { useGoal } from './execution/use-goal';
import type { SwapRisk } from './launch/swap-guard';
import type { NextPorts } from './next-ui/next-http';
import { NextRunAnnouncements } from './next-ui/NextRunAnnouncements';
import { oneCheck } from './next-ui/one-check';
import { useNextData } from './next-ui/use-next-data';
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

type ViewId = 'designer' | 'execution';

// The calls of a page that has no session to run anything through. It is one
// object for the life of the page, so the run controller holds one state for
// as long as there is nothing to follow.
const NO_RUN_PORTS: RunViewPorts = {
  start: () =>
    Promise.reject(new Error('The page has no session to start a run with.')),
  readEvents: undefined,
  listRuns: undefined,
  scheduler: timerScheduler,
  now: () => Date.now(),
};

/**
 * True when the Run view draws a workflow, so it has a Run button. A load
 * can succeed with no view: no file yet, or a file with errors.
 */
function drawsWorkflow(result: LoadResult | undefined): boolean {
  return result?.ok === true && result.workflow.document.view !== null;
}

/**
 * Root component: the top bar, then the page header (breadcrumbs, the name of
 * the workflow as the title, and the Design and Run switch), then the
 * selected view. Both views draw the workflow that `load` settles with, and
 * Run runs it, waiting with `scheduler` between two reads of the run.
 *
 * With `nextUi`, the two newer views take the place of the ones they
 * replaced, `nextPortsFor` gives them the calls they need beyond the
 * session's own, and the Run view is the one that follows a run: the
 * controller of the Run tab stays idle, and the run it reports drives the
 * swap guard and the live region.
 */
export function App({
  load,
  notice,
  scheduler = timerScheduler,
  runMemory,
  swapRisk,
  nextUi = false,
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
   * Draw the two newer views. `main.tsx` reads the address and turns this on
   * unless `?ui=classic` asks for the views they replaced. It is off here so
   * that a caller which says nothing gets the older views.
   */
  nextUi?: boolean;
  /**
   * Builds the calls those views make for the workflow that has just loaded.
   * It is called once per load, with that workflow, so each one has its own
   * calls and they address the session it was loaded with.
   */
  nextPortsFor?: (workflow: LoadedWorkflow) => NextPorts;
}) {
  // Read here, not in the tab, so switching tabs does not load again.
  const result = useSettled(load);
  // The calls of the newer views belong to the workflow that loaded, so
  // each load gets its own; the hooks of those views tell workflows apart by
  // them.
  const nextPorts = useMemo(
    () =>
      nextUi && result?.ok && nextPortsFor
        ? nextPortsFor(result.workflow)
        : undefined,
    [nextUi, result, nextPortsFor],
  );
  // One follower at a time: with the newer views on the page, the Run
  // view follows the run, so the controller of the Run tab is left idle.
  const execution = useExecution(
    !nextUi && result?.ok ? result.workflow.runs : undefined,
    scheduler,
    runMemory,
  );
  const [goal, setGoal] = useGoal(result);
  const [mode, toggleMode] = useThemeMode();
  // The load the page draws, held by its identity as well as its content: the
  // editor is opened with it, and the views that keep anything of their own
  // tell one workflow from another by it.
  const opened = result?.ok ? result.workflow : undefined;
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
  // The editor of the newer views checks through that one call. Without
  // `checks`, which only `nextUi` builds, the load is the one that came, so
  // the views this page replaced are left alone.
  const loaded = useMemo(
    () =>
      opened && checks
        ? { ...opened, edits: { ...opened.edits, check: checks.check } }
        : opened,
    [opened, checks],
  );
  // The Designer edits a draft; the run and the Execution tab use the file
  // as it is saved.
  const editor = useEditor(loaded, scheduler);
  const unsaved = editor ? isDirty(editor.state) : false;
  // The draft lives in the page, so leaving the page loses the changes.
  useLeaveGuard(unsaved, window);
  // One object until the saved file changes, as the tab draws a new canvas
  // for each new result.
  const document = editor?.state.saved;
  const saved = useMemo(
    () => (document ? withDocument(result, document) : result),
    [result, document],
  );
  const [view, setView] = useState<ViewId>('designer');
  const workflowName = openWorkflowName(saved);
  const next = useNextData({
    ports: nextPorts,
    reload: document?.hash,
  });
  const runs = result?.ok ? result.workflow.runs : undefined;
  const stageNames = useMemo(
    () =>
      (saved?.ok ? (saved.workflow.document.view?.stages ?? []) : []).map(
        (stage) => stage.name,
      ),
    [saved],
  );
  // The calls the newer Run view follows a run through,
  // which belong to the workflow that loaded: another workflow is another
  // object, and the controller starts again for it, the run its session kept
  // included.
  const nextRunPorts = useMemo(
    () =>
      nextUi && nextPorts && runs
        ? {
            start: runs.start,
            readEvents: nextPorts.readEvents,
            listRuns: nextPorts.listRuns,
            scheduler,
            now: () => Date.now(),
          }
        : NO_RUN_PORTS,
    [nextUi, nextPorts, runs, scheduler],
  );
  // The page follows the run, not the tab that draws it: a person who looks
  // at the Design view must not take the only follower off the page.
  const nextRunner = useRunController({
    stages: stageNames,
    ...(next.extras.goalDefault === undefined
      ? {}
      : { goalDefault: next.extras.goalDefault }),
    ports: nextRunPorts,
    // Only once there is a session: the page has no run of its own to keep
    // before one, and the controller drops the run of the session it is
    // handed a new one in place of.
    ...(runMemory && nextRunPorts !== NO_RUN_PORTS ? { runMemory } : {}),
  });
  const nextRun = nextRunner.lifecycle;
  const running = isInFlight(execution.state) || nextRun.active;
  const nextViews: PageView<ViewId>[] | undefined =
    nextUi && editor && nextPorts && runs && loaded && checks
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
            content: <RunView controller={nextRunner} />,
          },
        ]
      : undefined;
  const views: PageView<ViewId>[] = nextViews ?? [
    {
      id: 'designer',
      label: 'Design',
      content: <Designer result={result} editor={editor} />,
    },
    {
      id: 'execution',
      label: 'Run',
      content: (
        <Execution
          result={saved}
          execution={execution}
          goal={goal}
          onGoalChange={setGoal}
          unsaved={unsaved}
        />
      ),
    },
  ];
  useEffect(
    () => swapRisk?.set({ draft: unsaved, run: running }),
    [swapRisk, unsaved, running],
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
                    onChange={setView}
                  />
                }
              >
                {workflowName ?? 'Workflow canvas'}
              </Header>
            }
          >
            {notice}
            {next.failure !== undefined && (
              <Alert type="warning" data-testid="next-data-error">
                {next.failure}
              </Alert>
            )}
            {nextViews ? (
              <NextRunAnnouncements run={nextRun} />
            ) : (
              <RunAnnouncements
                state={execution.state}
                loaded={drawsWorkflow(saved)}
              />
            )}{' '}
            <ModePanels views={views} active={view} />
          </ContentLayout>
        }
      />
    </>
  );
}
