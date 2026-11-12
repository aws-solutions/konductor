// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Breadcrumbs } from './chrome/Breadcrumbs';
import './chrome/chrome.css';
import { ModePanels, ModeSwitch, type PageView } from './chrome/ModeSwitch';
import { TOP_BAR_ID, TopBar } from './chrome/TopBar';
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
import { useThemeMode } from './theme/use-theme-mode';
import {
  openWorkflowName,
  withDocument,
  type LoadResult,
} from './workflow/load-workflow';

type ViewId = 'designer' | 'execution';

/**
 * Root component: the top bar, then the page header (breadcrumbs, the name of
 * the workflow as the title, and the Designer and Execution switch), then the
 * selected view. Both views draw the workflow that `load` settles with, and
 * Execution runs it, waiting with `scheduler` between two reads of the run.
 */
export function App({
  load,
  notice,
  scheduler = timerScheduler,
  runMemory,
  swapRisk,
}: {
  load: Promise<LoadResult>;
  /** Shown above the view, such as the refusal of a pasted launch address. */
  notice?: ReactNode;
  scheduler?: Scheduler;
  /** Keeps the latest run across a reload; a page without it starts afresh. */
  runMemory?: RunMemory;
  /** Told what another workflow would take from the page. */
  swapRisk?: SwapRisk;
}) {
  // Read here, not in the tab, so switching tabs does not load again.
  const result = useSettled(load);
  // Kept here too, so a run goes on and the goal stays while the Designer tab
  // is open.
  const execution = useExecution(
    result?.ok ? result.workflow.runs : undefined,
    scheduler,
    runMemory,
  );
  const [goal, setGoal] = useGoal(result);
  const [mode, toggleMode] = useThemeMode();
  // The Designer edits a draft; the run and the Execution tab use the file
  // as it is saved.
  const editor = useEditor(result?.ok ? result.workflow : undefined, scheduler);
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
  const running = isInFlight(execution.state);
  const [view, setView] = useState<ViewId>('designer');
  const workflowName = openWorkflowName(saved);
  const views: PageView<ViewId>[] = [
    {
      id: 'designer',
      label: 'Designer',
      content: <Designer result={result} editor={editor} />,
    },
    {
      id: 'execution',
      label: 'Execution',
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
            <RunAnnouncements
              state={execution.state}
              loaded={result?.ok === true}
            />
            <ModePanels views={views} active={view} />
          </ContentLayout>
        }
      />
    </>
  );
}
