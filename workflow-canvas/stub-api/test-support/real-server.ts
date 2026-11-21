// SPDX-License-Identifier: Apache-2.0
/**
 * Starts the real server, `konductor flow view`, for the suite that otherwise
 * runs against the stub. Set `WC_SERVER_BIN` to the `konductor` binary to use
 * it. The project is a temporary folder with the sample workflow files and the
 * prompt files they name, a scratch home and a fake harness, and the root is
 * trusted first, as a user would with `konductor flow trust`.
 *
 * What the stub's fixtures simulate, the real server is put into:
 * `untrusted` is a root that is not trusted, `busy` is a lock that another
 * process holds, `blocks` is a fake reply that ends the stage badly, and
 * `harnessUnavailable` is a harness that is not on the `PATH`.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { FIXTURES, SAMPLE_FILES, SAMPLE_ROOT } from '../core/sample.ts';
import type { Behavior } from '../core/sample.ts';
import type { StageReason } from '../core/model.ts';

/** The binary of the real server, or undefined for the stub. */
export const SERVER_BIN = process.env.WC_SERVER_BIN || undefined;

/** A test that needs the stub's own controls, such as its clock. */
export class NotApplicable extends Error {}

export interface RealServer {
  host: string;
  port: number;
  origin: string;
  launchCode: string;
  close(): Promise<void>;
}

export interface RealOptions {
  files?: Readonly<Record<string, string>>;
  root?: string;
  behavior?: Behavior;
  launchCode: string;
}

/** The run that another program holds, as the `busy` fixture of the stub has it. */
export const BUSY_RUN_ID = '20261024-0412-00001';

const SUCCESS = 'KONDUCTOR_RESULT {"status": "success", "outputs": []}';

/** The reply of the fake harness that ends a stage with this reason, if the first release can. */
const BLOCKING_REPLY: Partial<Record<StageReason, object>> = {
  RESULT_MISSING: { reply: 'I forgot to report.' },
  RESULT_INVALID: { reply: 'KONDUCTOR_RESULT {not json' },
  RESULT_FAILURE: {
    reply: 'KONDUCTOR_RESULT {"status": "failure", "outputs": []}',
  },
  SESSION_FAILED: { reply: 'no', exit_status: 1 },
  TIMEOUT: { reply: SUCCESS, duration_ms: 31 * 60_000 },
};

/** Whether the first release of the server can produce this reason. */
export const canBlockFor = (reason: StageReason): boolean =>
  reason in BLOCKING_REPLY;

function stageNames(text: string): string[] {
  return [...text.matchAll(/^ {2}- name: ([a-z0-9-]+)$/gm)].map(
    (m) => m[1] ?? '',
  );
}

/** A process that holds the workspace lock, and the run it says it runs. */
function holdWorkspace(project: string, stages: string[]): ChildProcess {
  const runs = join(project, '.konductor/runs');
  mkdirSync(join(runs, BUSY_RUN_ID), { recursive: true });
  const owner = { pid: 1, started: '2026-10-24T04:12:05Z' };
  const run = {
    run_id: BUSY_RUN_ID,
    workflow: 'busy',
    harness: 'fake',
    status: 'running',
    started_at: '2026-10-24T04:12:05Z',
    finished_at: null,
    exit_code: null,
    order: stages,
    stages: Object.fromEntries(
      stages.map((s, i) => [s, { status: i === 0 ? 'running' : 'pending' }]),
    ),
    reported_outputs: {},
    checks: {},
    owner,
  };
  writeFileSync(
    join(runs, BUSY_RUN_ID, 'state.json'),
    JSON.stringify(run, null, 2),
  );
  const lock = join(runs, 'lock');
  writeFileSync(lock, JSON.stringify({ ...owner, run_id: BUSY_RUN_ID }));
  // The shell opens the lock file, takes the lock and becomes `sleep`.
  return spawn(
    'sh',
    ['-c', 'exec 9<>"$0"; flock --exclusive 9 && exec sleep 3600', lock],
    { stdio: 'ignore' },
  );
}

export async function startRealServer(
  bin: string,
  options: RealOptions,
): Promise<RealServer> {
  const root = options.root ?? SAMPLE_ROOT;
  const files = options.files ?? SAMPLE_FILES;
  const behavior = options.behavior ?? FIXTURES[root]?.behavior ?? {};
  // The real server needs the root file at its start. A root with no file is
  // a usage error of `flow view`, so a test that needs it has no real twin.
  const text = files[root];
  if (text === undefined) throw new NotApplicable('the root has no file');
  const dir = mkdtempSync(join(tmpdir(), 'wc-real-server-'));
  const project = join(dir, 'project');
  const home = join(dir, 'home');
  const page = join(dir, 'page');
  const workflows = join(project, '.konductor/workflows');
  for (const folder of [workflows, home, page]) {
    mkdirSync(folder, { recursive: true });
  }
  writeFileSync(join(page, 'index.html'), '<!doctype html><title>t</title>');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(workflows, `${name}.yml`), content);
    // A workflow reads its prompt files at check time, as the stub does not.
    for (const m of content.matchAll(/^\s+prompt_file: (\S+)$/gm)) {
      writeFileSync(join(workflows, m[1] ?? ''), 'Review the draft.');
    }
  }
  if (behavior.blocks && !canBlockFor(behavior.blocks.reason)) {
    throw new NotApplicable(
      'the first release cannot end a stage for this reason',
    );
  }
  const stages = stageNames(text);
  const blocked = behavior.blocks;
  const entries = stages.map((stage, index) => {
    const stop =
      blocked && index === Math.min(blocked.stage, stages.length - 1)
        ? BLOCKING_REPLY[blocked.reason]
        : undefined;
    return [stage, stop ?? { reply: SUCCESS }];
  });
  const script = join(dir, 'script.json');
  writeFileSync(
    script,
    JSON.stringify({ stages: Object.fromEntries(entries) }),
  );
  // The stub's own harness is `kiro-cli`, so a missing one has the stub's words.
  const harness = behavior.harnessUnavailable ? 'kiro-cli' : 'fake';
  const env = {
    ...process.env,
    HOME: home,
    KONDUCTOR_CANVAS_DIR: page,
    KONDUCTOR_FAKE_SCRIPT: script,
    KONDUCTOR_LAUNCH_CODE: options.launchCode,
    // A harness that is not installed is one that no folder of the PATH has.
    ...(behavior.harnessUnavailable ? { PATH: '/usr/bin:/bin' } : {}),
  };
  if (!behavior.untrusted) {
    try {
      execFileSync(bin, ['flow', 'trust', root, '--yes'], {
        cwd: project,
        env,
        stdio: 'ignore',
      });
    } catch {
      // A workflow with errors cannot be trusted, and its tests do not run.
    }
  }
  const holder = behavior.busy ? holdWorkspace(project, stages) : undefined;
  const child = spawn(bin, ['flow', 'view', root, '--harness', harness], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const cleanup = () => {
    holder?.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  const line = await new Promise<string>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    lines.once('line', resolve);
    child.once('exit', (code) =>
      reject(new Error(`konductor flow view ended with ${code}`)),
    );
  }).catch((error: unknown) => {
    cleanup();
    throw error;
  });
  const match = /^http:\/\/127\.0\.0\.1:(\d+)\/#(\S+)$/.exec(line);
  if (!match) throw new Error(`not a launch address: ${line}`);
  return {
    host: '127.0.0.1',
    origin: `http://127.0.0.1:${match[1]}`,
    port: Number(match[1]),
    launchCode: match[2] ?? '',
    close: () =>
      new Promise((resolve) => {
        child.once('exit', () => {
          cleanup();
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}
