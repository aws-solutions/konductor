// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Tabs from '@cloudscape-design/components/tabs';
import { Breadcrumbs } from './chrome/Breadcrumbs';
import './chrome/chrome.css';
import { TOP_BAR_ID, TopBar } from './chrome/TopBar';
import { Designer } from './designer/Designer';
import { useSettled } from './designer/use-settled';
import type { RunMemory, Scheduler } from './execution/core';
import { Execution } from './execution/Execution';
import { RunAnnouncements } from './execution/RunAnnouncements';
import { timerScheduler } from './execution/timer-scheduler';
import { useExecution } from './execution/use-execution';
import { useGoal } from './execution/use-goal';
import { TAB_STRIP_STYLE } from './theme/tokens';
import { useThemeMode } from './theme/use-theme-mode';
import { openWorkflowName, type LoadResult } from './workflow/load-workflow';

/**
 * Root component: the top bar, then the page header (breadcrumbs and title)
 * with the Designer and Execution tabs. Both tabs draw the workflow that
 * `load` settles with, and the Execution tab runs it, waiting with
 * `scheduler` between two reads of the run.
 */
export function App({
  load,
  scheduler = timerScheduler,
  runMemory,
}: {
  load: Promise<LoadResult>;
  scheduler?: Scheduler;
  /** Keeps the latest run across a reload; a page without it starts afresh. */
  runMemory?: RunMemory;
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
            <RunAnnouncements state={execution.state} />
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
                  {
                    id: 'execution',
                    label: 'Execution',
                    content: (
                      <Execution
                        result={result}
                        execution={execution}
                        goal={goal}
                        onGoalChange={setGoal}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </ContentLayout>
        }
      />
    </>
  );
}
