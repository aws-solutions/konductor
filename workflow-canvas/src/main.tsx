// SPDX-License-Identifier: Apache-2.0
import '@cloudscape-design/global-styles/index.css';
import './theme/fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHttpApi } from './api/http-api';
import { LaunchNotice } from './launch/LaunchNotice';
import { takeLaunchCode, watchLaunchCode } from './launch/launch-code';
import { sessionStorageMemory } from './launch/session-memory';
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
watchLaunchCode(window, (code) => void source.offer(code));

function Root() {
  return (
    <App
      load={useWorkflowSource(source)}
      notice={<LaunchNotice source={source} />}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
