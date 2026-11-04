// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { WorkflowApi } from '../api/api';
import { createHttpApi } from '../api/http-api';
import { HELLO_DOCUMENT, HELLO_SESSION } from '../test-support/fixtures';
import { freshMemory } from '../test-support/memory-storage';
import { useWorkflowSource } from '../workflow/use-workflow-source';
import { createWorkflowSource } from '../workflow/workflow-source';
import { LaunchWait, STILL_WAITING_MS } from './LaunchWait';

// The page as main.tsx wires it, over a server whose launch code trade a test
// controls.
function pageWith(createSession: WorkflowApi['createSession']) {
  const api: WorkflowApi = {
    createSession,
    getWorkflow: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    saveWorkflow: vi.fn(),
    checkWorkflow: vi.fn(),
    startRun: vi.fn(),
    getRun: vi.fn(),
  };
  const source = createWorkflowSource(api, 'code-1', freshMemory());
  function Root() {
    const load = useWorkflowSource(source);
    return (
      <App load={load} notice={<LaunchWait load={load} source={source} />} />
    );
  }
  render(<Root />);
}

function hangingSession() {
  let finish: (value: typeof HELLO_SESSION) => void = () => {};
  const createSession: WorkflowApi['createSession'] = (_code, signal) =>
    new Promise((resolve, reject) => {
      finish = resolve;
      signal?.addEventListener('abort', () =>
        reject(new Error('The trade was stopped.')),
      );
    });
  return { createSession, finish: (value = HELLO_SESSION) => finish(value) };
}

describe('LaunchWait', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says nothing while the server answers in time', async () => {
    vi.useFakeTimers();
    pageWith(() => Promise.resolve(HELLO_SESSION));

    await act(() => vi.advanceTimersByTimeAsync(STILL_WAITING_MS + 1000));

    expect(screen.queryByTestId('launch-wait')).toBeNull();
    expect(screen.getByTestId('node-stage-draft')).toBeTruthy();
  });

  it('says it is still waiting after the threshold, not before', async () => {
    vi.useFakeTimers();
    const server = hangingSession();
    pageWith(server.createSession);

    await act(() => vi.advanceTimersByTimeAsync(STILL_WAITING_MS - 1));
    expect(screen.queryByTestId('launch-wait')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(screen.getByTestId('launch-wait').textContent).toContain(
      'Still waiting for the server',
    );
  });

  it('draws the workflow and drops the notice when a late answer comes', async () => {
    vi.useFakeTimers();
    const server = hangingSession();
    pageWith(server.createSession);
    await act(() => vi.advanceTimersByTimeAsync(STILL_WAITING_MS));

    await act(async () => server.finish());

    expect(screen.queryByTestId('launch-wait')).toBeNull();
    expect(screen.getByTestId('node-stage-draft')).toBeTruthy();
  });

  it('aborts the trade on Stop waiting and shows the error', async () => {
    vi.useFakeTimers();
    const server = hangingSession();
    pageWith(server.createSession);
    await act(() => vi.advanceTimersByTimeAsync(STILL_WAITING_MS));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    });

    expect(screen.queryByTestId('launch-wait')).toBeNull();
    expect(screen.getByText('The workflow did not load')).toBeTruthy();
    expect(screen.getByText(/The trade was stopped/)).toBeTruthy();
  });

  it('ends in the explicit error at the hard limit of the real client', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const api = createHttpApi(fetchFn as unknown as typeof fetch);
    const source = createWorkflowSource(api, 'code-1', freshMemory());
    function Root() {
      const load = useWorkflowSource(source);
      return (
        <App load={load} notice={<LaunchWait load={load} source={source} />} />
      );
    }
    render(<Root />);

    await act(() => vi.advanceTimersByTimeAsync(120_000));

    expect(screen.queryByTestId('launch-wait')).toBeNull();
    expect(screen.getByText('The workflow did not load')).toBeTruthy();
    expect(screen.getByText(/may have used it/)).toBeTruthy();
  });
});
