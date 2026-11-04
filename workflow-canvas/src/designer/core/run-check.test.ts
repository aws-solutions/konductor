// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { FakeScheduler } from '../../test-support/fake-scheduler';
import { HELLO_VIEW } from '../../test-support/fixtures';
import type { EditEvent } from './edit-state';
import { SessionLost, type EditPort } from './ports';
import { CHECK_DELAY_MS, checkAfterPause } from './run-check';

const FINDINGS = [
  { message: 'Wrong.', path: 'stages[0].name', line: 3, severity: 'error' },
] as const;

function edits(check: EditPort['check']): EditPort {
  return { save: vi.fn(), check, reload: vi.fn() };
}

function request(port: EditPort, scheduler = new FakeScheduler()) {
  const events: EditEvent[] = [];
  const controller = new AbortController();
  const done = checkAfterPause({
    edits: port,
    scheduler,
    text: 'text',
    revision: 4,
    emit: (event) => events.push(event),
    signal: controller.signal,
  });
  return { events, controller, scheduler, done };
}

describe('checkAfterPause', () => {
  it('waits for the pause before it makes the call', async () => {
    const check = vi.fn().mockResolvedValue({ view: null, diagnostics: [] });
    const { scheduler, done } = request(edits(check));

    expect(scheduler.waits).toEqual([CHECK_DELAY_MS]);
    expect(check).not.toHaveBeenCalled();
    scheduler.tick();
    await done;

    expect(check).toHaveBeenCalledWith('text');
  });

  it('tells emit what the check found, for the revision it was asked about', async () => {
    const check = vi
      .fn()
      .mockResolvedValue({ view: null, diagnostics: FINDINGS });
    const { events, scheduler, done } = request(edits(check));

    scheduler.tick();
    await done;

    expect(events).toEqual([
      { type: 'checked', revision: 4, diagnostics: FINDINGS },
    ]);
  });

  it('makes no call and says nothing when it is aborted during the pause', async () => {
    const check = vi.fn();
    const { events, controller, done } = request(edits(check));

    controller.abort();
    await done;

    expect(check).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('says nothing when it is aborted during the call', async () => {
    let answer: (value: unknown) => void = () => {};
    const check = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { events, controller, scheduler, done } = request(
      edits(check as unknown as EditPort['check']),
    );
    scheduler.tick();
    await Promise.resolve();

    controller.abort();
    answer({ view: HELLO_VIEW, diagnostics: [] });
    await done;

    expect(events).toEqual([]);
  });

  it('says that the session is lost when the check is refused for it', async () => {
    const check = vi.fn().mockRejectedValue(new SessionLost('Gone.'));
    const { events, scheduler, done } = request(edits(check));

    scheduler.tick();
    await done;

    expect(events).toEqual([{ type: 'session-lost', message: 'Gone.' }]);
  });

  it('says nothing about a lost session when it was aborted', async () => {
    const check = vi.fn().mockRejectedValue(new SessionLost('Gone.'));
    const { events, controller, scheduler, done } = request(edits(check));
    scheduler.tick();
    controller.abort();
    await done;

    expect(events).toEqual([]);
  });

  it('says nothing and does not reject when the call fails', async () => {
    const check = vi.fn().mockRejectedValue(new Error('No answer.'));
    const { events, scheduler, done } = request(edits(check));

    scheduler.tick();

    await expect(done).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });
});
