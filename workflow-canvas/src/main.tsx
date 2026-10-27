// SPDX-License-Identifier: Apache-2.0
import '@cloudscape-design/global-styles/index.css';
import './theme/fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sessionRunMemory } from './execution/run-memory';
import { createHttpApi } from './api/http-api';
import { takeLaunchCode } from './launch/launch-code';
import { installTheme } from './theme/install';
import { loadWorkflow } from './workflow/load-workflow';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

installTheme(document.body);

// Started once, outside React: the launch code works only once, and strict mode
// runs effects twice.
const load = loadWorkflow(createHttpApi(), takeLaunchCode(window));

createRoot(root).render(
  <StrictMode>
    <App load={load} runMemory={sessionRunMemory(window)} />
  </StrictMode>,
);
