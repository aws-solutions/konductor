// SPDX-License-Identifier: Apache-2.0
import '@cloudscape-design/global-styles/index-base.css';
import './theme/fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sessionRunMemory } from './execution/run-memory';
import { createHttpApi } from './api/http-api';
import { LaunchNotice } from './launch/LaunchNotice';
import { takeLaunchCode, watchLaunchCode } from './launch/launch-code';
import { sessionStorageMemory } from './launch/session-memory';
import { createSwapRisk, guardOffers } from './launch/swap-guard';
import { installTheme } from './theme/install';
import { useWorkflowSource } from './workflow/use-workflow-source';
import { createWorkflowSource } from './workflow/workflow-source';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

installTheme(document.body);

const source = createWorkflowSource(
  createHttpApi(),
  takeLaunchCode(window),
  sessionStorageMemory(window),
);
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
  return (
    <App
      load={useWorkflowSource(source)}
      notice={<LaunchNotice source={source} />}
      runMemory={runMemory}
      swapRisk={swapRisk}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
