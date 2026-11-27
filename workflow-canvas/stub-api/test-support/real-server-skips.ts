// SPDX-License-Identifier: Apache-2.0
/**
 * The tests of the stub's HTTP suite that cannot run against the real server
 * (`WC_SERVER_BIN`), each with the reason. Without that variable nothing here
 * is read, and every test runs on the stub.
 */

interface Task {
  name: string;
  suite?: Task;
}

interface Skip {
  /** Matches the names of the suites and the test, joined by ` > `. */
  test: RegExp;
  why: string;
}

const CLOCK =
  'reads the stub clock to see a run in the middle, which the fake harness finishes in a moment';
const IDS =
  'expects the run id that the stub counts, and the real server makes its own';
const HARNESS =
  'expects the stub to serve the harness kiro-cli, and the real server serves the one it was started with';

const STUB_TIMES =
  'expects the start times of the stub clock, and the real server stamps its own';

const EVENTS =
  'the real server does not serve getRunEvents until the events step adds the event sink and events.jsonl';

const LIBRARY =
  'the real server does not serve the workflow library yet (follow-up 28)';
const SLICE_2 =
  'the engine does not read data-between-stages keys yet (slice 2)';
const SLICE_3A = 'the engine does not read check keys yet (slice 3a)';

const SKIPS: Skip[] = [
  {
    test: /paths and methods > answers an unknown path with 404/,
    why: 'the real server serves the page at /, as the contract allows',
  },
  {
    test: /POST \/api\/run > accepts the run (at once|without a name) and returns its id/,
    why: IDS,
  },
  {
    test: /POST \/api\/run > refuses a second run while one is active, with the id of the first/,
    why: CLOCK,
  },
  {
    test: /GET \/api\/runs\/\{id} > shows the first stage running when the run starts/,
    why: CLOCK,
  },
  {
    test: /GET \/api\/runs\/\{id} > goes through stage 1, stage 2 and the end as the clock moves/,
    why: CLOCK,
  },
  {
    test: /a run that ends with a blocked stage > halts at the blocked stage with its reason, and leaves the next pending/,
    why: CLOCK,
  },
  {
    test: /POST \/api\/session > trades the launch code for a token and says what it serves/,
    why: HARNESS,
  },
  {
    test: /POST \/api\/session > refuses the launch code once 60 seconds have passed/,
    why: 'moves the stub clock past the launch window',
  },
  {
    test: /the wire types of the page read POST \/api\/session > with the reply of the stub/,
    why: HARNESS,
  },
  {
    test: /POST \/api\/validate > answers the laterSlice request of the contract with its example/,
    why: 'compares the prose of the message, which names the key by its path in the real server',
  },
  {
    test: /PUT \/api\/workflow > refuses a stage with parallel, and names the slice that adds it/,
    why: 'compares the prose of the message, which names the key by its path in the real server',
  },
  {
    test: /^GET \/api\/runs > lists the runs it played, newest first, each with its goal$/,
    why: STUB_TIMES,
  },
  {
    test: /^GET \/api\/runs\/\{id}\/events(?! > is not_found)/,
    why: EVENTS,
  },
  {
    test: /^POST \/api\/run > is a bad request with a param that is not a string$/,
    why: SLICE_2,
  },
  {
    test: /^POST \/api\/run of a workflow that declares data > (?!keeps the goal on its own|refuses a name that is only an inherited property)/,
    why: SLICE_2,
  },
  {
    test: /^POST \/api\/run of a workflow with a required param > /,
    why: SLICE_2,
  },
  {
    test: /^POST \/api\/run when a declared output is left unwritten > /,
    why: SLICE_2,
  },
  {
    test: /^POST \/api\/run when an unwritten output is not declared > /,
    why: SLICE_2,
  },
  {
    test: /^POST \/api\/run when the unwritten output is only on the prototype > /,
    why: SLICE_2,
  },
  {
    test: /^the checks of a run over HTTP > (defers every declared check|verifies the check of a stage)/,
    why: SLICE_3A,
  },
  {
    test: /^(GET|POST) \/api\/library(?!\/\{name\}(\/copy)? > answers an unknown entry)|^the library with(?!.*is over the limit by its own count)/,
    why: LIBRARY,
  },
];

function fullName(task: Task): string {
  return task.suite?.name
    ? `${fullName(task.suite)} > ${task.name}`
    : task.name;
}

/** The reason to skip this test against the real server, or undefined. */
export function skipAgainstRealServer(task: Task): string | undefined {
  const name = fullName(task);
  return SKIPS.find((skip) => skip.test.test(name))?.why;
}
