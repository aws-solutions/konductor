// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { WorkflowApi } from '../api/api';
import { HELLO_DOCUMENT, HELLO_SESSION } from '../test-support/fixtures';
import { freshMemory } from '../test-support/memory-storage';
import { useWorkflowSource } from './use-workflow-source';
import { createWorkflowSource } from './workflow-source';

describe('the page, under strict mode', () => {
  it('opens one session for the launch code, though effects run twice', async () => {
    const api: WorkflowApi = {
      createSession: vi.fn().mockResolvedValue(HELLO_SESSION),
      getWorkflow: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
      startRun: vi.fn(),
      getRun: vi.fn(),
    };
    const source = createWorkflowSource(api, 'code-1', freshMemory());
    function Root() {
      return <App load={useWorkflowSource(source)} />;
    }

    render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );

    expect(await screen.findByTestId('node-stage-draft')).toBeTruthy();
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith('code-1');
  });
});
