// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../execution/core/ports';
import { startFollowing, type FollowedRun } from '../execution/core/run-follow';
import {
  CONSOLE_GRACE_MS,
  followRunEvents,
  LONG_POLL_WAIT_S,
  MAX_FAILURES_IN_A_ROW,
  MIN_POLL_GAP_MS,
  REQUEST_LIMIT_MS,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  type EventsReply,
  type FollowEnd,
  type SendRequest,
} from './follow-run-events';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A clock that moves only when the test moves it. */
class FakeClock {
  time = 0;
  readonly waits: number[] = [];
  private timers: { at: number; resolve: () => void }[] = [];

  readonly now = () => this.time;

  readonly scheduler: Scheduler = {
    wait: (ms, signal) => {
      if (ms !== REQUEST_LIMIT_MS) this.waits.push(ms);
      return new Promise((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const timer = { at: this.time + ms, resolve };
        this.timers.push(timer);
        signal.addEventListener(
          'abort',
          () => {
            this.timers = this.timers.filter((other) => other !== timer);
            resolve();
          },
          { once: true },
        );
      });
    },
  };

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      await settle();
      const due = this.timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      due.resolve();
    }
    this.time = target;
    await settle();
  }
}

type Step =
  | { status: number; body: unknown }
  | { status: number; bodyError: Error }
  | 'no answer'
  | 'hang'
  | 'open';

/** A server that answers each call with the next step of its script. */
class FakeServer {
  readonly paths: string[] = [];
  readonly headers: Record<string, string>[] = [];
  readonly signals: AbortSignal[] = [];
  inFlight = 0;
  mostInFlight = 0;
  private pending: ((reply: EventsReply) => void) | undefined;

  constructor(private readonly steps: Step[]) {}

  readonly send: SendRequest = (path, { headers, signal }) => {
    this.paths.push(path);
    this.headers.push(headers);
    this.signals.push(signal);
    this.inFlight += 1;
    this.mostInFlight = Math.max(this.mostInFlight, this.inFlight);
    const done = () => {
      this.inFlight -= 1;
    };
    const step = this.steps.shift() ?? 'hang';
    return new Promise<EventsReply>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
      if (step === 'no answer') reject(new Error('offline'));
      else if (step === 'open') this.pending = resolve;
      else if (step === 'hang') return;
      else if ('bodyError' in step) {
        const { status, bodyError } = step;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.reject(bodyError),
        });
      } else resolve(replyOf(step.status, step.body));
    }).finally(done);
  };

  answerOpen(body: unknown): void {
    this.pending?.(replyOf(200, body));
    this.pending = undefined;
  }
}

function replyOf(status: number, body: unknown): EventsReply {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const ok = (body: unknown): Step => ({ status: 200, body });

const running = (seq: number, stage: string) => ({
  seq,
  run_id: 'r1',
  at: '2026-10-24T04:12:05Z',
  type: 'stage_state',
  stage,
  status: 'running',
});
const passed = (seq: number, stage: string) => ({
  ...running(seq, stage),
  status: 'passed',
});
const line = (seq: number, stage: string, n: number, text: string) => ({
  seq,
  run_id: 'r1',
  at: '2026-10-24T04:12:06Z',
  type: 'console',
  stage,
  n,
  text,
});
const finishedEvent = (seq: number) => ({
  seq,
  run_id: 'r1',
  at: '2026-10-24T04:12:49Z',
  type: 'run_finished',
  status: 'passed',
  exit_code: 0,
});

function page(
  events: readonly {
    readonly seq: number;
    readonly [field: string]: unknown;
  }[],
  finished = false,
  next?: number,
) {
  return { events, next: next ?? events.at(-1)?.seq ?? 0, finished };
}

function follow(
  server: FakeServer,
  clock: FakeClock,
  from: FollowedRun = startFollowing(['draft', 'review']),
) {
  const controller = new AbortController();
  const seen: FollowedRun[] = [];
  let end: FollowEnd | undefined;
  void followRunEvents({
    ports: { send: server.send, scheduler: clock.scheduler, now: clock.now },
    token: 'tok',
    runId: 'r1',
    from,
    onRun: (run) => seen.push(run),
    signal: controller.signal,
  }).then((result) => {
    end = result;
  });
  return { controller, seen, end: () => end };
}

const afterOf = (path: string) => new URL(path, 'http://x').searchParams;

describe('followRunEvents', () => {
  it('reads with a long poll until the run finishes', async () => {
    const server = new FakeServer([
      ok(page([running(1, 'draft'), line(2, 'draft', 1, 'Reading')])),
      ok(
        page([passed(3, 'draft'), passed(4, 'review'), finishedEvent(5)], true),
      ),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);

    expect(server.paths).toEqual([
      `/api/runs/r1/events?after=0&wait=${LONG_POLL_WAIT_S}`,
      `/api/runs/r1/events?after=2&wait=${LONG_POLL_WAIT_S}`,
    ]);
    expect(server.headers[0]).toEqual({ Authorization: 'Bearer tok' });
    expect(followed.seen).toHaveLength(2);
    expect(followed.end()).toMatchObject({
      kind: 'finished',
      run: { outcome: { status: 'passed', exitCode: 0 }, next: 5 },
    });
  });

  it('makes one more read after a finished answer that lacks the run_finished, and keeps the tail lines', async () => {
    const server = new FakeServer([
      ok(page([running(1, 'draft')])),
      ok(page([passed(2, 'draft'), running(3, 'review')], true)),
      ok(
        page([
          line(4, 'review', 1, 'Last line one'),
          line(5, 'review', 2, 'Last line two'),
          passed(6, 'review'),
          finishedEvent(7),
        ]),
      ),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);

    expect(server.paths.at(-1)).toBe('/api/runs/r1/events?after=3&wait=0');
    expect(server.paths).toHaveLength(3);
    const end = followed.end();
    expect(end?.kind).toBe('finished');
    expect(end?.run.stages[1]?.console.map((l) => l.text)).toEqual([
      'Last line one',
      'Last line two',
    ]);
    expect(end?.run.outcome).toEqual({ status: 'passed', exitCode: 0 });
  });

  it('stops after the one more read even when it brings nothing', async () => {
    const server = new FakeServer([
      ok(page([running(1, 'draft')], true)),
      ok(page([], true, 1)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);

    expect(server.paths).toHaveLength(2);
    expect(followed.end()).toMatchObject({ kind: 'finished' });
    expect(followed.end()?.run.outcome).toBeUndefined();
  });

  it('tries the last read again only while the server keeps the console lines', async () => {
    const server = new FakeServer([
      ok(page([running(1, 'draft')], true)),
      ...Array.from({ length: MAX_FAILURES_IN_A_ROW }, (): Step => 'no answer'),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(CONSOLE_GRACE_MS - 1);

    expect(followed.end()).toBeUndefined();
    await clock.advance(RETRY_MAX_MS);
    expect(followed.end()).toMatchObject({ kind: 'finished' });
    const lastReads = server.paths.slice(1);
    expect(lastReads.every((path) => afterOf(path).get('wait') === '0')).toBe(
      true,
    );
    expect(lastReads.length).toBeLessThan(MAX_FAILURES_IN_A_ROW);
  });

  it('takes a gap in seq for events the server no longer keeps, and resumes after the next it gave', async () => {
    const server = new FakeServer([
      ok(page([running(1, 'draft'), passed(4, 'draft')], false, 4)),
      ok(page([running(5, 'review')], false, 9)),
      ok(page([passed(10, 'review'), finishedEvent(11)], true)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);

    expect(server.paths.map((path) => afterOf(path).get('after'))).toEqual([
      '0',
      '4',
      '9',
    ]);
    expect(followed.end()?.run.stages.map((stage) => stage.status)).toEqual([
      'passed',
      'passed',
    ]);
  });

  it('skips an event of a later type and moves past it', async () => {
    const server = new FakeServer([
      ok(page([{ seq: 1, run_id: 'r1', at: 'x', type: 'stage_note' }])),
      ok(page([finishedEvent(2)], true)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);

    expect(afterOf(server.paths[1]!).get('after')).toBe('1');
    expect(followed.end()?.kind).toBe('finished');
  });

  it('backs off after errors and recovers, then starts the back-off again', async () => {
    const server = new FakeServer([
      { status: 503, body: { error: 'Busy.' } },
      'no answer',
      ok(page([running(1, 'draft')])),
      'no answer',
      ok(page([finishedEvent(2)], true)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(RETRY_FIRST_MS * 4);

    expect(clock.waits).toEqual([
      RETRY_FIRST_MS,
      RETRY_FIRST_MS * 2,
      RETRY_FIRST_MS,
    ]);
    expect(server.paths.map((path) => afterOf(path).get('after'))).toEqual([
      '0',
      '0',
      '0',
      '1',
      '1',
    ]);
    expect(followed.end()?.kind).toBe('finished');
  });

  it('caps the back-off, and gives up after too many failures in a row', async () => {
    const server = new FakeServer(
      Array.from({ length: MAX_FAILURES_IN_A_ROW }, (): Step => ({
        status: 502,
        body: undefined,
      })),
    );
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(RETRY_MAX_MS * MAX_FAILURES_IN_A_ROW);

    expect(Math.max(...clock.waits)).toBe(RETRY_MAX_MS);
    expect(clock.waits).toHaveLength(MAX_FAILURES_IN_A_ROW - 1);
    expect(followed.end()).toMatchObject({
      kind: 'failed',
      message: 'The server answered 502.',
    });
  });

  it('stops at once when the server refuses the call, with its message', async () => {
    const server = new FakeServer([
      { status: 404, body: { error: 'There is no run with this id.' } },
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(RETRY_MAX_MS);

    expect(server.paths).toHaveLength(1);
    expect(followed.end()).toMatchObject({
      kind: 'failed',
      message: 'There is no run with this id.',
    });
  });

  it('stops when an answer cannot be read', async () => {
    const server = new FakeServer([ok({ events: 'none' })]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);

    expect(followed.end()).toMatchObject({
      kind: 'failed',
      message: 'The events of the run could not be read.',
    });
  });

  it('stops when a 200 answer is not JSON, without trying again', async () => {
    const server = new FakeServer([
      { status: 200, bodyError: new SyntaxError('Unexpected token <') },
      ok(page([finishedEvent(1)], true)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(RETRY_MAX_MS);

    expect(server.paths).toHaveLength(1);
    expect(followed.end()).toMatchObject({
      kind: 'failed',
      message: 'The events of the run could not be read.',
    });
  });

  it('tries again when the body of a 200 answer stops arriving', async () => {
    const server = new FakeServer([
      { status: 200, bodyError: new TypeError('network error') },
      ok(page([finishedEvent(1)], true)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(RETRY_FIRST_MS);

    expect(server.paths).toHaveLength(2);
    expect(followed.end()?.kind).toBe('finished');
  });

  it('gives up on a call that outlasts its limit, and tries again', async () => {
    const server = new FakeServer(['hang', ok(page([finishedEvent(1)], true))]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(REQUEST_LIMIT_MS - 1);

    expect(server.paths).toHaveLength(1);
    await clock.advance(1 + RETRY_FIRST_MS);
    expect(server.signals[0]?.aborted).toBe(true);
    expect(server.paths).toHaveLength(2);
    expect(followed.end()?.kind).toBe('finished');
  });

  it('waits between answers that bring nothing new', async () => {
    const server = new FakeServer([
      ok(page([], false, 0)),
      ok(page([finishedEvent(1)], true)),
    ]);
    const clock = new FakeClock();
    follow(server, clock);
    await clock.advance(MIN_POLL_GAP_MS - 1);

    expect(server.paths).toHaveLength(1);
    await clock.advance(1);
    expect(server.paths).toHaveLength(2);
  });

  it('ends a long poll in flight when aborted, and says nothing more', async () => {
    const server = new FakeServer(['open']);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);
    followed.controller.abort();
    server.answerOpen(page([running(1, 'draft')]));
    await clock.advance(RETRY_MAX_MS);

    expect(server.signals[0]?.aborted).toBe(true);
    expect(followed.seen).toEqual([]);
    expect(server.paths).toHaveLength(1);
    expect(followed.end()?.kind).toBe('aborted');
  });

  it('ends a back-off wait when aborted', async () => {
    const server = new FakeServer(['no answer']);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);
    followed.controller.abort();
    await clock.advance(0);

    expect(followed.end()?.kind).toBe('aborted');
    expect(server.paths).toHaveLength(1);
  });

  it('never has two calls in flight', async () => {
    const server = new FakeServer([
      'open',
      'hang',
      'no answer',
      'open',
      ok(page([finishedEvent(3)], true)),
    ]);
    const clock = new FakeClock();
    const followed = follow(server, clock);
    await clock.advance(0);
    server.answerOpen(page([running(1, 'draft')]));
    await clock.advance(REQUEST_LIMIT_MS + RETRY_FIRST_MS * 3);
    server.answerOpen(page([passed(2, 'draft')]));
    await clock.advance(0);

    expect(server.paths).toHaveLength(5);
    expect(server.mostInFlight).toBe(1);
    expect(followed.end()?.kind).toBe('finished');
  });

  it('starts from the next of a run it already knows, and does not call for a finished one', async () => {
    const known = { ...startFollowing(['draft']), next: 7 };
    const server = new FakeServer([ok(page([finishedEvent(8)], true))]);
    const clock = new FakeClock();
    const followed = follow(server, clock, known);
    await clock.advance(0);

    expect(afterOf(server.paths[0]!).get('after')).toBe('7');

    const again = new FakeServer([]);
    const second = follow(again, clock, followed.end()!.run);
    await clock.advance(0);
    expect(again.paths).toEqual([]);
    expect(second.end()?.kind).toBe('finished');
  });

  it('puts the run id in the path as one segment', async () => {
    const server = new FakeServer([ok(page([finishedEvent(1)], true))]);
    const clock = new FakeClock();
    const controller = new AbortController();
    await followRunEvents({
      ports: { send: server.send, scheduler: clock.scheduler, now: clock.now },
      token: 'tok',
      runId: 'a/b?c',
      from: startFollowing([]),
      onRun: () => {},
      signal: controller.signal,
    });

    expect(server.paths[0]).toMatch(/^\/api\/runs\/a%2Fb%3Fc\/events\?/);
  });
});
