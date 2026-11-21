// SPDX-License-Identifier: Apache-2.0
import '@cloudscape-design/global-styles/index-base.css';
import './theme/fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sessionRunMemory } from './execution/run-memory';
import { createHttpApi } from './api/http-api';
import { LaunchNotice } from './launch/LaunchNotice';
import { LaunchWait } from './launch/LaunchWait';
import { takeLaunchCode, watchLaunchCode } from './launch/launch-code';
import { sessionStorageMemory } from './launch/session-memory';
import { createSwapRisk, guardOffers } from './launch/swap-guard';
import { createNextPorts } from './next-ui/next-http';
import { wantsNextUi } from './next-ui/next-ui';
import { forgetIfStill } from './next-ui/session-forget';
import { tapSessions } from './next-ui/session-tap';
import { installTheme } from './theme/install';
import { useWorkflowSource } from './workflow/use-workflow-source';
import type { LoadedWorkflow } from './workflow/load-workflow';
import { createWorkflowSource } from './workflow/workflow-source';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

installTheme(document.body);

const sessions = sessionStorageMemory(window);

// The views being built need calls that the API client does not have yet.
// Each loaded workflow gets its own, built from the token that workflow was
// loaded with, so no call of theirs can address another session.
const nextUi = wantsNextUi(window.location.search);
const tap = tapSessions(createHttpApi());

const nextPortsFor = (workflow: LoadedWorkflow) => {
  const token = tap.tokenOf(workflow.document);
  // A 401 of this token drops the kept session only while it is still that
  // token's: a call of a workflow that has been replaced can answer after the
  // new one was kept.
  return createNextPorts(token, {
    onSessionLost: forgetIfStill(sessions, token),
  });
};

const source = createWorkflowSource(tap.api, takeLaunchCode(window), sessions);
const swapRisk = createSwapRisk();
watchLaunchCode(
  window,
  guardOffers(
    swapRisk,
    (question) => window.confirm(question),
    (code) => void source.offer(code),
  ),
);

const runMemory = sessionRunMemory(window);

function Root() {
  const load = useWorkflowSource(source);
  return (
    <App
      load={load}
      notice={
        <>
          <LaunchWait load={load} source={source} />
          <LaunchNotice source={source} />
        </>
      }
      runMemory={runMemory}
      swapRisk={swapRisk}
      nextUi={nextUi}
      nextPortsFor={nextPortsFor}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
