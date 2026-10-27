// SPDX-License-Identifier: Apache-2.0
import AppLayout from '@cloudscape-design/components/app-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Tabs from '@cloudscape-design/components/tabs';
import { Breadcrumbs } from './chrome/Breadcrumbs';
import './chrome/chrome.css';
import { TOP_BAR_ID, TopBar } from './chrome/TopBar';
import { Designer } from './designer/Designer';
import { isDirty } from './designer/core';
import { useEditor } from './designer/use-editor';
import { useLeaveGuard } from './designer/use-leave-guard';
import { useSettled } from './designer/use-settled';
import type { RunMemory, Scheduler } from './execution/core';
import { Execution } from './execution/Execution';
import { timerScheduler } from './execution/timer-scheduler';
import { useExecution } from './execution/use-execution';
import { TAB_STRIP_STYLE } from './theme/tokens';
import { useThemeMode } from './theme/use-theme-mode';
import {
  openWorkflowName,
  withDocument,
  type LoadResult,
} from './workflow/load-workflow';

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
  // Kept here too, so a run goes on while the Designer tab is open.
  const execution = useExecution(
    result?.ok ? result.workflow.runs : undefined,
    scheduler,
    runMemory,
  );
  const [mode, toggleMode] = useThemeMode();
  // The Designer edits a draft; the run and the Execution tab use the file
  // as it is saved.
  const editor = useEditor(result?.ok ? result.workflow : undefined, scheduler);
  const unsaved = editor ? isDirty(editor.state) : false;
  // The draft lives in the page, so leaving the page loses the changes.
  useLeaveGuard(unsaved, window);
  const saved = editor ? withDocument(result, editor.state.saved) : result;
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
            breadcrumbs={<Breadcrumbs workflowName={openWorkflowName(saved)} />}
            header={<Header variant="h1">Workflow canvas</Header>}
          >
            <div className="wf-tab-strip">
              <Tabs
                ariaLabel="Workflow canvas views"
                style={TAB_STRIP_STYLE}
                tabs={[
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
                        unsaved={unsaved}
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
