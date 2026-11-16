// SPDX-License-Identifier: Apache-2.0
// Tests for the OpenCode judge client (scripts/bench/lib/opencode.js). No model and no AWS call: the process
// runner is a stub, or a stub `opencode` script that records what it was given. The ledger is a temp file.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const oc = require('../../../scripts/bench/lib/opencode');
const { createLedger } = require('../../../scripts/bench/lib/ledger');
const { classifyError } = require('../../../scripts/bench/lib/retry');
const helpers = require('./helpers');
const { callCost } = require('../../../scripts/bench/lib/cost-profile');

const CONFIG = helpers.exampleConfig();
const OPUS = 'us.anthropic.claude-opus-5-5';
const GROK = 'us.xai.grok-4.7';
const TERRA = 'us.openai.gpt-6.1-terra';
/** Prices from the committed cost profile: a call reserves its p90 and, with no usable cost, is charged its mean. */
const OPUS_JUDGE = callCost(CONFIG, 'judge', OPUS);
const OPUS_WRITER = callCost(CONFIG, 'writer', OPUS);
const TERRA_JUDGE = callCost(CONFIG, 'judge', TERRA);
/** The names of the models' entries in a call's OpenCode config. */
const OPUS_ENTRY = 'benchmark-us-anthropic-claude-opus-5-5';
const GROK_ENTRY = 'benchmark-us-xai-grok-4-7';
const TERRA_ENTRY = 'benchmark-gpt-6-1-terra';
const LIMIT = CONFIG.judge_max_output_tokens;
/** The by-seat limits of the committed settings (the openai seat is Terra's, the xai seat Grok's). */
const TERRA_LIMIT = CONFIG.judge_max_output_tokens_by_seat.openai;
const GROK_LIMIT = CONFIG.judge_max_output_tokens_by_seat.xai;
/**
 * USD per million tokens, input (the highest rate) and output, as the cost profile holds them. Written out here so a
 * change to a price in the profile is seen by a test.
 */
const PRICES = {
  [OPUS]: [5.5, 22],
  [GROK]: [2.2, 6.6],
  [TERRA]: [1.375, 5.5],
};
/**
 * What a call reserves, worked out from first principles: the prompt's bytes over 3 plus 4000 tokens of OpenCode's own
 * input, at the input price, plus the output limit at the output price, rounded up to a millionth of a dollar.
 */
const ceilingUsd = (modelId, prompt = 'judge this', limit = LIMIT) => {
  const [input, output] = PRICES[modelId];
  const inputTokens = Math.ceil(Buffer.byteLength(prompt, 'utf8') / 3) + 4000;
  return Math.ceil(inputTokens * input + limit * output) / 1e6;
};
const mode = (file) => fs.statSync(file).mode & 0o777;
const REPLY = '{"items":["MET","MISSING"],"reason":"item 2 is missing"}';

/** A JSON event line of an OpenCode trace. */
const line = (type, part, extra = {}) =>
  JSON.stringify({ type, sessionID: 'ses_stub1', part, ...extra });
const judgeTrace = ({
  text = REPLY,
  tokens = { input: 1000, output: 200 },
  cost = 0.01,
  reason,
} = {}) =>
  [
    line('step_start', { type: 'step-start' }),
    line('text', { type: 'text', text }),
    ...(tokens
      ? [
          line('step_finish', {
            type: 'step-finish',
            tokens,
            cost,
            ...(reason === undefined ? {} : { reason }),
          }),
        ]
      : []),
  ].join('\n') + '\n';

/** `opencode run --help` text of an older OpenCode that has `--standalone`, and of a newer one that does not. */
const HELP_WITH_STANDALONE =
  'opencode run [message..]\n\nOptions:\n  --format      output format\n  --standalone  run a private server\n';
const HELP_WITHOUT_STANDALONE =
  'opencode run [message..]\n\nOptions:\n  --format      output format\n  --auto        approve\n';
const isHelpCall = (args) =>
  args.length === 2 && args[0] === 'run' && args[1] === '--help';

/**
 * A stub for proc.run: records each call and answers with `respond(call)` (default: a valid judge trace). The
 * `opencode run --help` probe is answered with `helpText` and recorded in `helpCalls`, not in `calls`.
 */
function stubRun(
  respond = () => ({ stdout: judgeTrace() }),
  { helpText = HELP_WITH_STANDALONE } = {},
) {
  const calls = [];
  const helpCalls = [];
  const run = async (command, args, options) => {
    const call = { command, args, options };
    if (isHelpCall(args)) {
      helpCalls.push(call);
      return {
        code: 0,
        stdout: helpText,
        stderr: '',
        ms: 1,
        timedOut: false,
      };
    }
    // What the sandbox looked like while the process "ran".
    call.sandboxMode = mode(options.cwd.replace(/\/project$/, ''));
    call.config = JSON.parse(
      fs.readFileSync(path.join(options.cwd, 'opencode.json'), 'utf8'),
    );
    calls.push(call);
    return {
      code: 0,
      stdout: '',
      stderr: '',
      ms: 5,
      timedOut: false,
      overflow: false,
      ...respond(call),
    };
  };
  return { run, calls, helpCalls };
}

const rowsOf = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((text) => JSON.parse(text))
    : [];

/** Runs callback({ dir, ledger, ledgerFile, call }) with a temp ledger; `call` is judgeCall with test defaults. */
async function withJudge(callback) {
  return helpers.withTmpAsync(async (dir) => {
    const ledgerFile = path.join(dir, 'out', 'ledger.jsonl');
    const ledger = createLedger({
      file: ledgerFile,
      limits: { max_usd: 25, total_cap_usd: 100 },
      runId: 'test',
    });
    const tmpRoot = path.join(dir, 'tmp');
    fs.mkdirSync(tmpRoot);
    const call = (options) =>
      oc.judgeCall({
        ledger,
        config: CONFIG,
        modelId: OPUS,
        prompt: 'judge this',
        label: 'test/judge',
        tmpRoot,
        baseEnv: { PATH: process.env.PATH, HOME: dir },
        ...options,
      });
    return callback({ dir, ledger, ledgerFile, tmpRoot, call });
  });
}

test('lockdown: only the Bedrock provider, every tool denied by default and by name, execute off, share off', () => {
  const config = oc.judgeConfig({ region: 'us-west-2' });
  assert.deepEqual(config.enabled_providers, ['amazon-bedrock']);
  assert.equal(config.share, 'disabled');
  assert.equal(config.permission['*'], 'deny');
  for (const [tool, setting] of Object.entries(config.permission))
    assert.equal(setting, 'deny', tool);
  for (const tool of [
    'read',
    'glob',
    'grep',
    'list',
    'edit',
    'bash',
    'webfetch',
    'websearch',
    'task',
    'external_directory',
    'skill',
  ])
    assert.ok(Object.hasOwn(config.permission, tool), tool);
  assert.deepEqual(
    Object.keys(config.permission).sort(),
    ['*', ...oc.DENIED_TOOLS].sort(),
  );
  assert.deepEqual(config.tools, { execute: false });
  assert.ok(!('mcp' in config));
  assert.deepEqual(Object.keys(config.provider), ['amazon-bedrock']);
  assert.deepEqual(config.provider, config.providers);
});

test('lockdown: the region comes from the settings and no AWS profile is ever set', () => {
  const config = oc.judgeConfig({
    modelId: TERRA,
    region: 'eu-central-1',
    maxOutputTokens: LIMIT,
  });
  assert.deepEqual(config.provider['amazon-bedrock'].settings, {
    region: 'eu-central-1',
  });
  assert.doesNotMatch(JSON.stringify(config), /profile/i);
  assert.throws(() => oc.judgeConfig({}), /region is required/);
});

test('model entries: every judge model gets its own entry, with the output limit and a context limit', () => {
  const entryOf = (modelId, maxOutputTokens) =>
    oc.judgeConfig({ modelId, region: 'us-west-2', maxOutputTokens }).provider[
      'amazon-bedrock'
    ];
  // `id` and `limit.context` are required by newer OpenCode versions; `modelID` is read by older ones.
  assert.deepEqual(entryOf(TERRA, 37500).models, {
    [TERRA_ENTRY]: {
      id: TERRA,
      modelID: TERRA,
      limit: { context: 272000, output: 37500 },
      settings: { maxTokens: 37500 },
    },
  });
  assert.deepEqual(entryOf(OPUS, 9000).models, {
    [OPUS_ENTRY]: {
      id: OPUS,
      modelID: OPUS,
      limit: { context: 200000, output: 9000 },
      settings: { maxTokens: 9000 },
    },
  });
  assert.deepEqual(entryOf(GROK, 256).models, {
    [GROK_ENTRY]: {
      id: GROK,
      modelID: GROK,
      limit: { context: 200000, output: 256 },
      settings: { maxTokens: 256 },
    },
  });
  assert.equal(oc.opencodeModelId(TERRA), TERRA_ENTRY);
  assert.equal(oc.opencodeModelId(OPUS), OPUS_ENTRY);
  assert.equal(oc.opencodeModelId(GROK), GROK_ENTRY);
  assert.equal(
    oc.opencodeModelId('qwen.qwen3-235b-a22b-2507-v1:0'),
    'benchmark-qwen-qwen3-235b-a22b-2507-v1-0',
  );
  // The version probe has no model, so its config has no entry.
  assert.ok(
    !(
      'models' in
      oc.judgeConfig({ region: 'us-west-2' }).provider['amazon-bedrock']
    ),
  );
});

test('model entries: the output limit is a whole number from 256 to 128000, and a model needs one', () => {
  for (const bad of [
    undefined,
    null,
    255,
    128001,
    1000.5,
    '5000',
    NaN,
    Infinity,
  ])
    assert.throws(
      () =>
        oc.judgeConfig({
          modelId: GROK,
          region: 'us-west-2',
          maxOutputTokens: bad,
        }),
      /maxOutputTokens must be a whole number from 256 to 128000/,
      String(bad),
    );
  for (const good of [256, 128000])
    assert.equal(
      oc.judgeConfig({
        modelId: GROK,
        region: 'us-west-2',
        maxOutputTokens: good,
      }).provider['amazon-bedrock'].models[GROK_ENTRY].limit.output,
      good,
    );
  assert.equal(oc.MIN_OUTPUT_TOKENS, 256);
  assert.equal(oc.MAX_OUTPUT_TOKENS, 128000);
});

test('sandbox: a private 0700 dir, a 0600 config only in the project dir, empty XDG dirs inside it', () => {
  helpers.withTmp((dir) => {
    const sandbox = oc.makeSandbox({
      modelId: TERRA,
      region: 'us-west-2',
      maxOutputTokens: LIMIT,
      tmpRoot: dir,
    });
    assert.ok(sandbox.root.startsWith(path.join(dir, 'bench-judge-')));
    assert.equal(mode(sandbox.root), 0o700);
    for (const sub of [
      sandbox.project,
      sandbox.xdgConfig,
      sandbox.xdgData,
      sandbox.xdgState,
    ]) {
      assert.ok(sub.startsWith(sandbox.root + path.sep));
      assert.equal(mode(sub), 0o700);
    }
    const configFile = path.join(sandbox.project, 'opencode.json');
    assert.equal(mode(configFile), 0o600);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(configFile, 'utf8')),
      oc.judgeConfig({
        modelId: TERRA,
        region: 'us-west-2',
        maxOutputTokens: LIMIT,
      }),
    );
    for (const sub of [sandbox.xdgConfig, sandbox.xdgData, sandbox.xdgState])
      assert.deepEqual(
        fs.readdirSync(sub),
        [],
        'the global OpenCode config (and its MCP servers) is not visible',
      );
  });
});

test('judge env: XDG dirs and OPENCODE_CONFIG point into the sandbox; ambient credentials pass; no profile is set', () => {
  helpers.withTmp((dir) => {
    const sandbox = oc.makeSandbox({ region: 'us-west-2', tmpRoot: dir });
    const env = oc.judgeEnv(sandbox, {
      region: 'us-west-2',
      base: {
        PATH: '/bin',
        HOME: '/h',
        AWS_ACCESS_KEY_ID: 'from-env',
        AWS_SESSION_TOKEN: 'from-env',
        OPENCODE_CONFIG: '/evil',
        OPENCODE_SERVER: 'http://x',
        ANTHROPIC_API_KEY: 'k',
        XDG_DATA_HOME: '/h/.local/share',
      },
    });
    assert.equal(env.AWS_ACCESS_KEY_ID, 'from-env');
    assert.equal(env.AWS_SESSION_TOKEN, 'from-env');
    assert.ok(!('AWS_PROFILE' in env));
    assert.equal(env.AWS_REGION, 'us-west-2');
    assert.equal(
      env.OPENCODE_CONFIG,
      path.join(sandbox.project, 'opencode.json'),
    );
    assert.ok(!('OPENCODE_SERVER' in env) && !('ANTHROPIC_API_KEY' in env));
    for (const name of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'])
      assert.ok(env[name].startsWith(sandbox.root), name);
    assert.equal(
      env.MISE_DATA_DIR,
      '/h/.local/share/mise',
      'tool shims keep finding their installs',
    );
    assert.equal(env.MISE_CONFIG_DIR, '/h/.config/mise');
    assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, '1');
    const pinned = oc.judgeEnv(sandbox, {
      region: 'us-west-2',
      base: { HOME: '/h', MISE_DATA_DIR: '/own' },
    });
    assert.equal(pinned.MISE_DATA_DIR, '/own', 'a value the user set is kept');
  });
});

test('judge env: exported credentials leave none of the parent credential variables behind', () => {
  helpers.withTmp((dir) => {
    const sandbox = oc.makeSandbox({ region: 'us-west-2', tmpRoot: dir });
    const names = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_SECURITY_TOKEN',
      'AWS_CREDENTIAL_EXPIRATION',
      'AWS_BEARER_TOKEN_BEDROCK',
      'AWS_ROLE_ARN',
      'AWS_ROLE_SESSION_NAME',
      'AWS_WEB_IDENTITY_TOKEN_FILE',
      'AWS_CONTAINER_CREDENTIALS_FULL_URI',
      'AWS_CONTAINER_AUTHORIZATION_TOKEN',
      'AWS_PROFILE',
      'AWS_DEFAULT_PROFILE',
    ];
    const env = oc.judgeEnv(sandbox, {
      region: 'us-west-2',
      credentials: { accessKeyId: 'AKIA-x', secretAccessKey: 's-secret' },
      base: {
        HOME: '/h',
        ...Object.fromEntries(names.map((name) => [name, 'ambient'])),
      },
    });
    for (const name of names)
      assert.ok(
        name === 'AWS_ACCESS_KEY_ID' || name === 'AWS_SECRET_ACCESS_KEY'
          ? env[name] !== 'ambient'
          : !(name in env),
        name,
      );
  });
});

test('judge env: exported credentials replace every credential variable of the parent', () => {
  helpers.withTmp((dir) => {
    const sandbox = oc.makeSandbox({ region: 'us-west-2', tmpRoot: dir });
    const credentials = {
      accessKeyId: 'ASIA-exported',
      secretAccessKey: 'exported-secret',
      sessionToken: 'exported-token',
    };
    const env = oc.judgeEnv(sandbox, {
      region: 'us-west-2',
      credentials,
      base: {
        HOME: '/h',
        PATH: '/usr/bin',
        AWS_PROFILE: 'other',
        AWS_ACCESS_KEY_ID: 'from-env',
        AWS_SESSION_TOKEN: 'from-env',
        AWS_WEB_IDENTITY_TOKEN_FILE: '/token',
      },
    });
    assert.equal(env.AWS_ACCESS_KEY_ID, 'ASIA-exported');
    assert.equal(env.AWS_SECRET_ACCESS_KEY, 'exported-secret');
    assert.equal(env.AWS_SESSION_TOKEN, 'exported-token');
    assert.ok(!('AWS_PROFILE' in env));
    assert.ok(!('AWS_WEB_IDENTITY_TOKEN_FILE' in env));
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.AWS_REGION, 'us-west-2');
    // A session token is optional; a key or secret is not.
    const noToken = oc.judgeEnv(sandbox, {
      region: 'us-west-2',
      credentials: { accessKeyId: 'AKIA-x', secretAccessKey: 's' },
      base: { HOME: '/h', AWS_SESSION_TOKEN: 'stale' },
    });
    assert.ok(!('AWS_SESSION_TOKEN' in noToken));
    assert.throws(
      () =>
        oc.judgeEnv(sandbox, {
          region: 'us-west-2',
          credentials: { accessKeyId: 'AKIA-x' },
          base: {},
        }),
      /credentials must have accessKeyId and secretAccessKey/,
    );
  });
});

test('usage estimate: a successful call with unreadable usage still shows that it used tokens', () => {
  const usage = oc.estimateUsage('p'.repeat(3000), 'a'.repeat(900));
  assert.deepEqual(usage, {
    input_tokens: 1000,
    output_tokens: 2300,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  });
});

test('modelArg: appends #effort only when one is set; the model id itself is never changed', () => {
  assert.equal(oc.modelArg(GROK), `amazon-bedrock/${GROK_ENTRY}`);
  assert.equal(oc.modelArg(GROK, null), `amazon-bedrock/${GROK_ENTRY}`);
  assert.equal(
    oc.modelArg(GROK, 'medium'),
    `amazon-bedrock/${GROK_ENTRY}#medium`,
  );
  assert.equal(oc.modelArg(TERRA), `amazon-bedrock/${TERRA_ENTRY}`);
  for (const bad of [
    'medium; rm -rf /',
    'a b',
    '../x',
    'HIGH',
    'x',
    '',
    // `#` starts the variant, so an effort holding one could append a second variant to the model argument.
    'low#x',
    'a#b',
    '#',
  ])
    assert.throws(
      () => oc.modelArg(GROK, bad),
      /unsafe reasoning effort/,
      JSON.stringify(bad),
    );
  for (const bad of [
    'x; rm -rf /',
    'a b',
    'm#high',
    'ab',
    '',
    'x'.repeat(121),
    undefined,
  ])
    assert.throws(
      () => oc.modelArg(bad),
      /unsafe model id/,
      JSON.stringify(bad),
    );
});

test('judgeTimeoutMs: the seat entry, else judge_timeout_ms', () => {
  assert.equal(oc.judgeTimeoutMs(CONFIG, 'xai'), 720000);
  assert.equal(oc.judgeTimeoutMs(CONFIG, 'anthropic'), 240000);
  assert.equal(oc.judgeTimeoutMs(CONFIG, 'unknown-seat'), 240000);
  // A seat named like an Object.prototype key is not looked up there.
  for (const seat of ['constructor', 'toString', '__proto__'])
    assert.equal(
      oc.judgeTimeoutMs(
        { judge_timeout_ms: 1000, judge_timeout_ms_by_seat: {} },
        seat,
      ),
      1000,
      seat,
    );
  const custom = helpers.exampleConfig({
    judge_timeout_ms: 100000,
    judge_timeout_ms_by_seat: { openai: 5000 },
  });
  assert.equal(oc.judgeTimeoutMs(custom, 'openai'), 5000);
  assert.equal(oc.judgeTimeoutMs(custom, 'anthropic'), 100000);
});

test('judgeCall: an unsafe model id or effort, a bad prompt or a stale credential is refused before any process or reservation', async () => {
  await withJudge(async ({ call, ledgerFile, tmpRoot }) => {
    const { run, calls } = stubRun();
    await assert.rejects(
      () => call({ run, modelId: 'x; rm -rf /' }),
      /unsafe model id/,
    );
    await assert.rejects(
      () => call({ run, reasoningEffort: 'high; rm -rf /' }),
      /unsafe reasoning effort/,
    );
    await assert.rejects(
      () => call({ run, prompt: '  ' }),
      /prompt must be a non-empty string/,
    );
    await assert.rejects(
      () => call({ run, prompt: 'x'.repeat(oc.MAX_PROMPT_BYTES + 1) }),
      /above the 131071-byte limit/,
    );
    // Multi-byte text is measured in bytes, the unit the OS limit uses.
    await assert.rejects(
      () => call({ run, prompt: '\u00e9'.repeat(70000) }),
      /140000 bytes/,
    );
    await assert.rejects(
      () => call({ run, timeoutMs: 0 }),
      /timeoutMs must be a number above 0/,
    );
    // Above the largest timer delay a timeout would fire at once and kill every call.
    for (const timeoutMs of [oc.MAX_CALL_TIMEOUT_MS + 1, 2 ** 31 + 5, Infinity])
      await assert.rejects(
        () => call({ run, timeoutMs }),
        /timeoutMs must be a number above 0 and at most 3600000/,
        String(timeoutMs),
      );
    const credentialGuard = {
      assertFresh: (label) => {
        throw new Error(`STOP: credentials expire in 2 minutes (${label})`);
      },
    };
    await assert.rejects(
      () => call({ run, credentialGuard }),
      /STOP: credentials expire in 2 minutes \(test\/judge\)/,
    );
    await assert.rejects(
      () => call({ run, ledger: null }),
      /ledger is required/,
    );
    await assert.rejects(
      () => call({ run, config: null }),
      /config is required/,
    );
    await assert.rejects(
      () => call({ run, callKind: 'subject' }),
      /callKind must be one of judge, writer, got "subject"/,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(rowsOf(ledgerFile), []);
    assert.deepEqual(fs.readdirSync(tmpRoot), [], 'no sandbox was made');
  });
});

test('judgeCall: the command line is opencode run --standalone --format json --auto -m <model> <prompt>, in the sandbox', async () => {
  await withJudge(async ({ call, tmpRoot }) => {
    const { run, calls } = stubRun();
    const result = await call({ run, prompt: 'line one\nline "two" $(x)' });
    assert.equal(result.ok, true);
    assert.equal(result.text, REPLY);
    const [{ command, args, options, sandboxMode, config }] = calls;
    assert.equal(command, 'opencode');
    assert.deepEqual(args, [
      'run',
      '--standalone',
      '--format',
      'json',
      '--auto',
      '-m',
      `amazon-bedrock/${OPUS_ENTRY}`,
      'line one\nline "two" $(x)',
    ]);
    assert.ok(options.cwd.startsWith(path.join(tmpRoot, 'bench-judge-')));
    assert.equal(path.basename(options.cwd), 'project');
    assert.equal(sandboxMode, 0o700);
    assert.deepEqual(
      config,
      oc.judgeConfig({
        modelId: OPUS,
        region: CONFIG.aws_region,
        maxOutputTokens: LIMIT,
      }),
    );
    assert.equal(
      options.env.OPENCODE_CONFIG,
      path.join(options.cwd, 'opencode.json'),
    );
    assert.deepEqual(
      fs.readdirSync(tmpRoot),
      [],
      'the sandbox is removed after the call',
    );
  });
});

test('judgeCall: an OpenCode without --standalone gets neither run nor session export with it', async () => {
  await withJudge(async ({ call }) => {
    const { run, calls, helpCalls } = stubRun(
      (entry) =>
        entry.args[0] === 'run'
          ? { stdout: judgeTrace({ tokens: null }) }
          : { stdout: 'nope' },
      { helpText: HELP_WITHOUT_STANDALONE },
    );
    const result = await call({ run });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(calls[0].args, [
      'run',
      '--format',
      'json',
      '--auto',
      '-m',
      `amazon-bedrock/${OPUS_ENTRY}`,
      'judge this',
    ]);
    assert.deepEqual(calls[1].args, ['session', 'export', 'ses_stub1']);
    // The probe ran in the call's sandbox with the call's environment.
    assert.equal(helpCalls.length, 1);
    assert.equal(helpCalls[0].options.cwd, calls[0].options.cwd);
    assert.equal(helpCalls[0].options.env, calls[0].options.env);
  });
});

test('judgeCall: the --help probe runs once per runner and binary; an unreadable help is read once more', async () => {
  await withJudge(async ({ call }) => {
    const { run, calls, helpCalls } = stubRun();
    await call({ run });
    await call({ run });
    assert.equal(helpCalls.length, 1, 'read once, then remembered');
    await call({ run, bin: 'opencode-other' });
    assert.equal(helpCalls.length, 2, 'another binary is read again');
    assert.ok(calls.every((entry) => entry.args[1] === '--standalone'));

    let helpAnswers = 0;
    const flaky = async (command, args, options) => {
      if (isHelpCall(args)) {
        helpAnswers += 1;
        return helpAnswers === 1
          ? { code: 1, stdout: '', stderr: 'crash', ms: 1, timedOut: false }
          : {
              code: 0,
              stdout: HELP_WITH_STANDALONE,
              stderr: '',
              ms: 1,
              timedOut: false,
            };
      }
      return run(command, args, options);
    };
    const before = calls.length;
    await call({ run: flaky });
    await call({ run: flaky });
    assert.equal(helpAnswers, 2, 'the failed read was asked again, once');
    assert.equal(calls[before].args[1], '--standalone', 'no guess');
    assert.equal(calls[before + 1].args[1], '--standalone');
  });
});

test('judgeCall: calls that start together share one --help probe', async () => {
  await withJudge(async ({ call }) => {
    const { run, calls, helpCalls } = stubRun();
    const results = await Promise.all([
      call({ run }),
      call({ run }),
      call({ run }),
    ]);
    assert.equal(helpCalls.length, 1);
    assert.equal(calls.length, 3);
    assert.ok(results.every((result) => result.ok));
  });
});

test('judgeCall: a help text unreadable twice fails the call clearly, charges 0, and is asked again by the next call', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    let helpAnswers = 0;
    const { run: answer, calls } = stubRun();
    const run = async (command, args, options) => {
      if (isHelpCall(args)) {
        helpAnswers += 1;
        return helpAnswers <= 2
          ? { code: null, stdout: '', stderr: '', ms: 1, timedOut: true }
          : {
              code: 0,
              stdout: HELP_WITHOUT_STANDALONE,
              stderr: '',
              ms: 1,
              timedOut: false,
            };
      }
      return answer(command, args, options);
    };
    const failed = await call({ run });
    assert.equal(helpAnswers, 2);
    assert.equal(calls.length, 0, 'no judge process started');
    assert.equal(failed.ok, false);
    assert.equal(failed.modelStarted, false);
    assert.match(
      failed.error,
      /^cannot read `opencode run --help` \(timed out, 2 tries\), so it is unknown whether this OpenCode needs --standalone$/,
    );
    const [reserve, settle] = rowsOf(ledgerFile);
    assert.equal(reserve.type, 'reserve');
    assert.equal(settle.usd, 0);
    assert.equal(settle.cost_source, 'none');
    assert.equal(settle.status, 'failed');
    const next = await call({ run });
    assert.equal(helpAnswers, 3, 'the failure was not remembered');
    assert.equal(next.ok, true);
    assert.equal(calls[0].args[1], '--format');
  });
});

test('judgeCall: passes #medium for an effort and the unchanged model argument without one', async () => {
  await withJudge(async ({ call }) => {
    const { run, calls } = stubRun();
    const withEffort = await call({
      run,
      modelId: GROK,
      reasoningEffort: 'medium',
    });
    const without = await call({ run, modelId: GROK });
    const modelOf = (entry) => entry.args[entry.args.indexOf('-m') + 1];
    assert.equal(modelOf(calls[0]), `amazon-bedrock/${GROK_ENTRY}#medium`);
    assert.equal(modelOf(calls[1]), `amazon-bedrock/${GROK_ENTRY}`);
    assert.equal(withEffort.reasoningEffort, 'medium');
    assert.equal(without.reasoningEffort, null);
  });
});

test('judgeCall: forwards timeoutMs to the process, defaults to judge_timeout_ms, and a timeout is a failed call', async () => {
  await withJudge(async ({ call }) => {
    const { run, calls } = stubRun(() => ({
      stdout: '',
      timedOut: true,
      code: null,
    }));
    const slow = await call({
      run,
      modelId: GROK,
      timeoutMs: oc.judgeTimeoutMs(CONFIG, 'xai'),
    });
    const plain = await call({ run });
    assert.equal(calls[0].options.timeoutMs, 720000);
    assert.equal(calls[1].options.timeoutMs, 240000);
    for (const result of [slow, plain]) {
      assert.equal(result.ok, false);
      assert.equal(result.error, 'timeout');
      assert.equal(result.timedOut, true);
    }
  });
});

test('ledger: a call is reserved first and settled at the cost OpenCode reports; the reservation outlives the call', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({
      stdout: judgeTrace({
        tokens: { input: 10000, output: 1000 },
        cost: 0.001,
      }),
    }));
    const result = await call({ run, timeoutMs: 100000 });
    const [reserve, settle] = rowsOf(ledgerFile);
    assert.equal(reserve.type, 'reserve');
    // The reservation is the call's ceiling (the prompt's tokens plus the output limit, at the model's prices), and
    // both rows name the call's kind and model.
    assert.equal(reserve.usd, ceilingUsd(OPUS));
    assert.equal(reserve.kind, 'judge');
    assert.equal(reserve.model, OPUS);
    assert.equal(reserve.label, 'test/judge');
    // The call timeout, the usage export (60 s) and a minute of slack; the two timestamps are read a moment apart.
    const ttlMs = Date.parse(reserve.expires) - Date.parse(reserve.ts);
    assert.ok(
      Math.abs(ttlMs - (100000 + 120000)) < 2000,
      `ttl ${ttlMs} covers the call and the usage export`,
    );
    assert.equal(settle.type, 'settle');
    assert.equal(settle.id, reserve.id);
    assert.equal(settle.status, 'ok');
    assert.equal(settle.cost_source, 'reported');
    assert.equal(settle.kind, 'judge');
    assert.equal(settle.model, OPUS);
    assert.equal(settle.usd, 0.001);
    assert.deepEqual(settle.tokens, {
      input_tokens: 10000,
      output_tokens: 1000,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    assert.equal(result.usageSource, 'stream');
    assert.equal(Object.hasOwn(result, 'pricedUsd'), false);
    assert.equal(result.reportedUsd, 0.001);
  });
});

test('ledger: a failed call with no usage is charged its mean once a model step started; it is never booked as $0', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({
      stdout: line('step_start', { type: 'step-start' }),
      code: 1,
      stderr: 'boom',
    }));
    const result = await call({ run });
    assert.equal(result.ok, false);
    assert.equal(result.usageSource, 'none');
    assert.equal(result.usage, null);
    assert.equal(result.modelStarted, true);
    assert.equal(result.error, 'exit 1: boom');
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.status, 'failed');
    assert.equal(settle.usd, OPUS_JUDGE.mean);
    assert.equal(settle.cost_source, 'estimate');
  });
});

test('ledger: a call that exits before any model step starts (a refused flag or config) is charged 0, cost_source none', async () => {
  for (const [name, response] of [
    ['usage printed, exit 1', { stdout: '', code: 1, stderr: 'usage: ...' }],
    [
      'an error event only',
      {
        stdout: line('error', undefined, {
          error: { name: 'ConfigInvalidError', data: { message: 'bad key' } },
        }),
        code: 1,
      },
    ],
  ])
    await withJudge(async ({ call, ledgerFile }) => {
      const { run } = stubRun(() => response);
      const result = await call({ run });
      assert.equal(result.ok, false, name);
      assert.equal(result.modelStarted, false, name);
      const [reserve, settle] = rowsOf(ledgerFile);
      assert.equal(reserve.usd, ceilingUsd(OPUS), `${name}: still reserved`);
      assert.equal(settle.usd, 0, name);
      assert.equal(settle.cost_source, 'none', name);
      assert.equal(settle.status, 'failed', name);
    });
  // A timeout with no step event may have reached the model: it keeps the mean.
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({ stdout: '', timedOut: true, code: null }));
    const result = await call({ run });
    assert.equal(result.modelStarted, true);
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, OPUS_JUDGE.mean);
    assert.equal(settle.cost_source, 'estimate');
  });
});

test('ledger: a process killed by a signal (exit code null, no timeout) with no model event keeps the mean', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({ stdout: '', code: null, stderr: '' }));
    const result = await call({ run });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.modelStarted, true);
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, OPUS_JUDGE.mean);
    assert.equal(settle.cost_source, 'estimate');
  });
});

test('judgeCall: the exported secret key and session token are removed from error text and stderr', async () => {
  await withJudge(async ({ call }) => {
    const credentials = {
      accessKeyId: 'ASIAEXAMPLEEXAMPLE01',
      secretAccessKey: 'plain-secret-value-not-key-shaped',
      sessionToken: 'plain-session-token-not-token-shaped',
    };
    const leak = `key ${credentials.secretAccessKey} token ${credentials.sessionToken}`;
    const { run } = stubRun(() => ({
      stdout: line('error', undefined, {
        error: { name: 'APIError', data: { message: leak } },
      }),
      code: 1,
      stderr: leak,
    }));
    const result = await call({ run, credentials });
    for (const text of [result.error, result.stderr]) {
      assert.ok(!text.includes(credentials.secretAccessKey), text);
      assert.ok(!text.includes(credentials.sessionToken), text);
    }
    const { run: exitRun } = stubRun(() => ({
      stdout: '',
      code: 2,
      stderr: leak,
    }));
    const exited = await call({ run: exitRun, credentials });
    assert.match(exited.error, /^exit 2: /);
    assert.ok(!exited.error.includes(credentials.secretAccessKey));
    assert.ok(!exited.error.includes(credentials.sessionToken));
  });
});

test('judgeCall: a label that carries the exported secret key or session token is written to the ledger without it', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const credentials = {
      accessKeyId: 'ASIAEXAMPLEEXAMPLE01',
      secretAccessKey: 'plain-secret-value-not-key-shaped',
      sessionToken: 'plain-session-token-not-token-shaped',
    };
    const { run } = stubRun();
    await call({
      run,
      credentials,
      label: `judge ${credentials.secretAccessKey} ${credentials.sessionToken}`,
    });
    const rows = rowsOf(ledgerFile);
    assert.ok(rows.length >= 2);
    const text = fs.readFileSync(ledgerFile, 'utf8');
    assert.ok(!text.includes(credentials.secretAccessKey), text);
    assert.ok(!text.includes(credentials.sessionToken), text);
    assert.equal(rows[0].label, 'judge [REDACTED] [REDACTED]');
  });
});

test('ledger: a writer call reserves its ceiling and is charged the writer mean when no usable cost is reported', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({
      stdout: line('step_start', { type: 'step-start' }),
      code: 1,
      stderr: 'boom',
    }));
    const result = await call({ run, callKind: 'writer' });
    assert.equal(result.ok, false);
    const [reserve, settle] = rowsOf(ledgerFile);
    assert.equal(reserve.type, 'reserve');
    assert.equal(reserve.kind, 'writer');
    assert.equal(reserve.usd, ceilingUsd(OPUS));
    assert.equal(settle.usd, OPUS_WRITER.mean);
    assert.equal(settle.cost_source, 'estimate');
    // The kind decides the mean charged, not the ceiling reserved: a writer has the model's token prices.
    assert.notEqual(OPUS_WRITER.mean, OPUS_JUDGE.mean);
  });
});

test('ledger: a model whose CLI reports low is charged at least its mean; a higher reported cost is kept', async () => {
  // OpenCode reports about 0.0009 USD for a GPT judge call, far below its profile mean (cliReportsLow).
  assert.equal(TERRA_JUDGE.cliReportsLow, true);
  for (const [name, reported, charged, source] of [
    ['reported below the mean', 0.0009, 0.01336, 'floor'],
    ['reported above the mean', 0.05, 0.05, 'reported'],
  ])
    await withJudge(async ({ call, ledgerFile }) => {
      const { run } = stubRun((entry) =>
        entry.args[0] === 'run'
          ? { stdout: judgeTrace({ cost: reported }) }
          : { code: 1, stdout: '' },
      );
      const result = await call({ run, modelId: TERRA });
      assert.equal(result.ok, true, name);
      assert.equal(result.reportedUsd, reported, name);
      const [reserve, settle] = rowsOf(ledgerFile);
      assert.equal(
        reserve.usd,
        ceilingUsd(TERRA, 'judge this', TERRA_LIMIT),
        name,
      );
      assert.equal(settle.usd, charged, name);
      assert.equal(settle.cost_source, source, name);
    });
  // A model whose CLI reports its cost faithfully is charged what it reports, even below its mean.
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun((entry) =>
      entry.args[0] === 'run'
        ? { stdout: judgeTrace({ cost: 0.0009 }) }
        : { code: 1, stdout: '' },
    );
    await call({ run });
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, 0.0009);
    assert.equal(settle.cost_source, 'reported');
  });
});

test('ledger: a reply with no usage and no cost anywhere is charged its mean', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run, calls } = stubRun((entry) =>
      entry.args[0] === 'run'
        ? { stdout: judgeTrace({ tokens: null }) }
        : { code: 1, stdout: '' },
    );
    const result = await call({ run, prompt: 'p'.repeat(3000) });
    assert.equal(result.ok, true);
    assert.equal(result.usageSource, 'char-estimate');
    assert.deepEqual(result.usage, oc.estimateUsage('p'.repeat(3000), REPLY));
    assert.deepEqual(
      calls[1].args,
      ['session', 'export', '--standalone', 'ses_stub1'],
      'the export was tried first',
    );
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, OPUS_JUDGE.mean);
    assert.equal(settle.cost_source, 'estimate');
  });
});

test('ledger: a reported cost that cannot be used is charged the mean', async () => {
  // [name, reported step cost]: 0 while the step shows tokens, below 0, and not a number.
  for (const [name, cost] of [
    ['zero with tokens', 0],
    ['negative', -0.5],
    ['not a number', 'free'],
  ]) {
    await withJudge(async ({ call, ledgerFile }) => {
      const { run } = stubRun((entry) =>
        entry.args[0] === 'run'
          ? { stdout: judgeTrace({ cost }) }
          : { code: 1, stdout: '' },
      );
      const result = await call({ run });
      assert.equal(result.ok, true, name);
      const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
      assert.equal(settle.usd, OPUS_JUDGE.mean, name);
      assert.equal(settle.cost_source, 'estimate', name);
    });
  }
});

test('ledger: a stream without step_finish takes usage and cost from the session export', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const exported = {
      info: {
        tokens: {
          input: 2000,
          output: 300,
          reasoning: 200,
          cache: { read: 50, write: 5 },
        },
        cost: 0.2,
      },
    };
    const { run, calls } = stubRun((entry) =>
      entry.args[0] === 'run'
        ? { stdout: judgeTrace({ tokens: null }) }
        : { stdout: JSON.stringify(exported) },
    );
    const result = await call({ run, modelId: GROK });
    assert.equal(result.usageSource, 'session-export');
    assert.deepEqual(result.usage, {
      input_tokens: 2000,
      output_tokens: 500,
      cache_read_tokens: 50,
      cache_write_tokens: 5,
    });
    assert.equal(result.reportedUsd, 0.2);
    assert.equal(calls[1].options.cwd, calls[0].options.cwd);
    assert.equal(calls[1].options.env, calls[0].options.env);
    // The cost reported in the export is charged.
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, 0.2);
    assert.equal(settle.cost_source, 'reported');
  });
});

test('ledger: an export that is not JSON, or has no session id to ask for, leaves the estimate', async () => {
  await withJudge(async ({ call }) => {
    const notJson = stubRun((entry) =>
      entry.args[0] === 'run'
        ? { stdout: judgeTrace({ tokens: null }) }
        : { stdout: 'nope' },
    );
    assert.equal(
      (await call({ run: notJson.run })).usageSource,
      'char-estimate',
    );
    const noSession = stubRun(() => ({
      stdout: JSON.stringify({ type: 'text', part: { text: REPLY } }),
    }));
    assert.equal(
      (await call({ run: noSession.run })).usageSource,
      'char-estimate',
    );
    assert.equal(noSession.calls.length, 1, 'no export without a session id');
  });
});

test('errors: a trace error, a tool that ran, an empty reply and an output flood each fail the call with a reason', async () => {
  await withJudge(async ({ call }) => {
    const cases = [
      [
        {
          stdout: line('error', undefined, {
            error: { message: 'ThrottlingException: slow down' },
          }),
        },
        /^ThrottlingException: slow down$/,
      ],
      [
        {
          stdout:
            judgeTrace() +
            line('tool_use', {
              tool: 'read',
              state: { status: 'completed', input: {} },
            }),
        },
        /ran 1 tool\(s\) although every tool is denied/,
      ],
      [{ stdout: judgeTrace({ text: '   ' }) }, /^empty reply$/],
      [
        { stdout: judgeTrace(), overflow: true, code: null },
        /output too large/,
      ],
    ];
    for (const [response, expected] of cases) {
      const { run } = stubRun(() => response);
      const result = await call({ run });
      assert.equal(result.ok, false);
      assert.match(result.error, expected);
    }
  });
});

test('errors: error text and stderr are redacted before they are returned', async () => {
  await withJudge(async ({ call }) => {
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    const { run } = stubRun(() => ({
      code: 1,
      stdout: line('error', undefined, {
        error: { message: `denied for ${key}` },
      }),
      stderr: `stack with ${key}`,
    }));
    const result = await call({ run });
    assert.ok(!JSON.stringify(result).includes(key));
    assert.match(result.error, /\[REDACTED_AWS_KEY_ID\]/);
    assert.match(result.stderr, /\[REDACTED_AWS_KEY_ID\]/);
  });
});

test('errors: a throw inside the call still settles the reservation and removes the sandbox', async () => {
  await withJudge(async ({ call, ledgerFile, tmpRoot }) => {
    const run = async () => {
      throw new Error('runner broke');
    };
    await assert.rejects(() => call({ run }), /runner broke/);
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.status, 'failed');
    assert.equal(settle.usd, OPUS_JUDGE.mean);
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
  });
});

test('errors: a spend stop is thrown before a process starts', async () => {
  await withJudge(async ({ call }) => {
    const { run, calls } = stubRun();
    // A judge model whose p90 is above the run's max_usd of 25: the reservation is refused.
    const costProfile = {
      entries: [{ kind: 'judge', model: OPUS, mean: 20, median: 20, p90: 30 }],
    };
    await assert.rejects(() => call({ run, costProfile }), /SPEND STOP/);
    assert.equal(calls.length, 0);
  });
});

test('judgeCallError: lib/retry.js sorts a failed call into the right class', () => {
  const kindOf = (result) => classifyError(oc.judgeCallError(result));
  assert.equal(kindOf({ error: 'timeout', stderr: '' }), 'transient');
  assert.equal(
    kindOf({ error: 'ThrottlingException: Too many requests', stderr: '' }),
    'transient',
  );
  assert.equal(
    kindOf({
      error: 'exit 1: x',
      stderr: 'Could not load credentials from any providers',
    }),
    'credential',
  );
  assert.equal(
    kindOf({ error: 'Provider blocked the response', stderr: '' }),
    'refusal',
  );
  assert.equal(
    kindOf({
      error: 'exit -1: spawn error: spawn opencode ENOENT',
      stderr: '',
    }),
    'permanent',
  );
  assert.equal(oc.judgeCallError({}).message, 'judge call failed');
});

// A stub `opencode` on disk: it records its argv, cwd, PWD, environment, the sandbox modes and the config it
// was given, then prints a judge trace. It proves what a real process receives, not what a fake runner saw.
// With `standalone: false` it acts as a newer OpenCode: its help has no --standalone, and given that flag it
// prints its usage and exits 1.
function writeStubBinary(dir, { standalone = true } = {}) {
  const recordFile = path.join(dir, 'stub-record.json');
  const stub = path.join(dir, 'opencode-stub');
  const helpText = standalone ? HELP_WITH_STANDALONE : HELP_WITHOUT_STANDALONE;
  const source = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const configFile = path.join(process.env.PWD, 'opencode.json');
const root = path.dirname(process.env.PWD);
const record = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  pwdReal: fs.realpathSync(process.env.PWD),
  pwd: process.env.PWD,
  env: process.env,
  rootMode: fs.statSync(root).mode & 0o777,
  configMode: fs.statSync(configFile).mode & 0o777,
  config: JSON.parse(fs.readFileSync(configFile, 'utf8')),
};
const previous = fs.existsSync(${JSON.stringify(recordFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(recordFile)}, 'utf8')) : [];
fs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify([...previous, record]));
if (process.argv[2] === '--version') { process.stdout.write('1.2.3\\n'); process.exit(0); }
if (process.argv[2] === 'run' && process.argv[3] === '--help') { process.stdout.write(${JSON.stringify(helpText)}); process.exit(0); }
if (${!standalone} && process.argv.includes('--standalone')) { process.stderr.write(${JSON.stringify(helpText)}); process.exit(1); }
process.stdout.write(${JSON.stringify(judgeTrace())});
`;
  fs.writeFileSync(stub, source, { mode: 0o700 });
  return {
    stub,
    records: () => JSON.parse(fs.readFileSync(recordFile, 'utf8')),
    /** The records of every call but the --help probe. */
    callRecords: () =>
      JSON.parse(fs.readFileSync(recordFile, 'utf8')).filter(
        (record) => !isHelpCall(record.argv),
      ),
  };
}

test('stub binary: the real process sees every tool denied, only Bedrock, a 0700 private dir and a clean environment', async () => {
  await withJudge(async ({ dir, call, tmpRoot }) => {
    const { stub, callRecords } = writeStubBinary(dir);
    const prompt = 'Judge the two answers.\n"quoted" $HOME `tick`';
    const result = await call({
      bin: stub,
      prompt,
      modelId: TERRA,
      baseEnv: {
        PATH: process.env.PATH,
        HOME: dir,
        AWS_ACCESS_KEY_ID: 'ASIA-from-env',
        OPENCODE_CONFIG: '/evil/opencode.json',
        ANTHROPIC_BASE_URL: 'http://elsewhere',
        NODE_OPTIONS: '--require /evil.js',
      },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.text, REPLY);
    const [record] = callRecords();
    assert.deepEqual(record.argv, [
      'run',
      '--standalone',
      '--format',
      'json',
      '--auto',
      '-m',
      `amazon-bedrock/${TERRA_ENTRY}`,
      prompt,
    ]);
    assert.equal(record.rootMode, 0o700);
    assert.equal(record.configMode, 0o600);
    assert.equal(
      record.cwd,
      record.pwdReal,
      'PWD names the directory the process runs in',
    );
    assert.ok(record.pwd.startsWith(path.join(tmpRoot, 'bench-judge-')));
    // Every tool denied, only the Bedrock provider.
    assert.equal(record.config.permission['*'], 'deny');
    assert.ok(
      Object.values(record.config.permission).every(
        (setting) => setting === 'deny',
      ),
    );
    assert.deepEqual(record.config.tools, { execute: false });
    assert.deepEqual(record.config.enabled_providers, ['amazon-bedrock']);
    assert.deepEqual(Object.keys(record.config.provider), ['amazon-bedrock']);
    assert.equal(
      record.config.provider['amazon-bedrock'].models['benchmark-gpt-6-1-terra']
        .modelID,
      TERRA,
    );
    assert.equal(
      record.config.provider['amazon-bedrock'].models['benchmark-gpt-6-1-terra']
        .id,
      TERRA,
    );
    // The environment: credentials from the parent, the sandbox config, nothing that redirects the call.
    assert.equal(record.env.AWS_ACCESS_KEY_ID, 'ASIA-from-env');
    assert.equal(
      record.env.OPENCODE_CONFIG,
      path.join(record.pwd, 'opencode.json'),
    );
    assert.ok(
      !('ANTHROPIC_BASE_URL' in record.env) && !('NODE_OPTIONS' in record.env),
    );
    assert.ok(!('AWS_PROFILE' in record.env));
    assert.equal(record.env.AWS_REGION, CONFIG.aws_region);
    for (const name of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'])
      assert.ok(record.env[name].startsWith(path.dirname(record.pwd)), name);
    assert.deepEqual(
      fs.readdirSync(tmpRoot),
      [],
      'the sandbox is removed after the call',
    );
  });
});

test('stub binary: an OpenCode with no --standalone (it exits 1 on the flag) still answers the call', async () => {
  await withJudge(async ({ dir, call }) => {
    const { stub, records, callRecords } = writeStubBinary(dir, {
      standalone: false,
    });
    const result = await call({ bin: stub });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.text, REPLY);
    assert.deepEqual(records()[0].argv, ['run', '--help']);
    assert.ok(!callRecords()[0].argv.includes('--standalone'));
  });
});

test('stub binary: a call given exported credentials, from a shell with no AWS_PROFILE and no keys, passes them to OpenCode', async () => {
  await withJudge(async ({ dir, call, ledgerFile }) => {
    const { stub, callRecords } = writeStubBinary(dir);
    const credentials = {
      accessKeyId: 'ASIA-exported',
      secretAccessKey: 'exported-secret',
      sessionToken: 'exported-token',
    };
    const result = await call({
      bin: stub,
      credentials,
      baseEnv: { PATH: process.env.PATH, HOME: dir },
    });
    assert.equal(result.ok, true, result.error);
    const [record] = callRecords();
    assert.equal(record.env.AWS_ACCESS_KEY_ID, 'ASIA-exported');
    assert.equal(record.env.AWS_SECRET_ACCESS_KEY, 'exported-secret');
    assert.equal(record.env.AWS_SESSION_TOKEN, 'exported-token');
    assert.ok(!JSON.stringify(result).includes('exported-secret'));
    assert.ok(!fs.readFileSync(ledgerFile, 'utf8').includes('exported'));
    // Credentials with no secret are refused before any process or reservation.
    const before = rowsOf(ledgerFile).length;
    await assert.rejects(
      () => call({ bin: stub, credentials: { accessKeyId: 'ASIA-x' } }),
      /credentials must have accessKeyId and secretAccessKey/,
    );
    assert.equal(rowsOf(ledgerFile).length, before);
  });
});

test('stub binary: readOpenCodeVersion runs --version in a throw-away sandbox', async () => {
  await withJudge(async ({ dir, tmpRoot }) => {
    const { stub, records } = writeStubBinary(dir);
    const version = await oc.readOpenCodeVersion({
      region: 'us-west-2',
      bin: stub,
      tmpRoot,
      baseEnv: { PATH: process.env.PATH, HOME: dir },
    });
    assert.equal(version, '1.2.3');
    const [record] = records();
    assert.deepEqual(record.argv, ['--version']);
    assert.equal(record.rootMode, 0o700);
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
  });
});

test('readOpenCodeVersion: a failed or odd answer throws with redacted text', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    const answers = [
      { code: 1, stdout: '', stderr: `no ${key}` },
      { code: 0, stdout: 'version 1.0 with spaces\n', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ];
    for (const answer of answers) {
      const run = async () => ({ ms: 1, timedOut: false, ...answer });
      await assert.rejects(
        () =>
          oc.readOpenCodeVersion({ region: 'us-west-2', run, tmpRoot: dir }),
        (error) =>
          /cannot read the OpenCode version/.test(error.message) &&
          !error.message.includes(key),
      );
    }
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('the client starts processes only through lib/proc.js and uses no network module or AWS SDK', () => {
  const lib = path.join(__dirname, '..', '..', '..', 'scripts', 'bench', 'lib');
  for (const fileName of ['opencode.js', 'opencode-trace.js', 'child-env.js']) {
    const text = fs.readFileSync(path.join(lib, fileName), 'utf8');
    assert.doesNotMatch(
      text,
      /require\(['"](node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)['"]\)/,
      fileName,
    );
    assert.doesNotMatch(text, /@aws-sdk|aws-sdk/, fileName);
  }
});

test("model entries: a model id that names an Object.prototype key gets a plain entry, never the prototype's", () => {
  for (const [modelId, entryId] of [
    ['constructor', 'benchmark-constructor'],
    ['toString', 'benchmark-tostring'],
    ['hasOwnProperty', 'benchmark-hasownproperty'],
    ['__proto__', 'benchmark-proto'],
  ]) {
    const bedrock = oc.judgeConfig({
      modelId,
      region: 'us-west-2',
      maxOutputTokens: 5000,
    }).provider['amazon-bedrock'];
    assert.deepEqual(Object.keys(bedrock.models), [entryId], modelId);
    assert.deepEqual(
      bedrock.models[entryId],
      {
        id: modelId,
        modelID: modelId,
        limit: { context: 200000, output: 5000 },
        settings: { maxTokens: 5000 },
      },
      modelId,
    );
    assert.equal(oc.opencodeModelId(modelId), entryId);
    assert.equal(oc.modelArg(modelId), `amazon-bedrock/${entryId}`);
  }
});

test('ledger: a settle that cannot be written fails the call with that error, keeps one reserve row and removes the sandbox', async () => {
  const failSettleRows = () => {
    const original = fs.appendFileSync;
    fs.appendFileSync = (file, data, ...rest) => {
      if (String(data).includes('"type":"settle"'))
        throw Object.assign(new Error('ENOSPC: no space left on device'), {
          code: 'ENOSPC',
        });
      return original(file, data, ...rest);
    };
    return () => {
      fs.appendFileSync = original;
    };
  };
  // The first runner answers a normal call; the second ends the call at the unreadable --help probe, which settles
  // on a path of its own.
  const unreadableHelp = async () => ({
    code: null,
    stdout: '',
    stderr: '',
    ms: 1,
    timedOut: true,
  });
  // A runner that throws leaves the settle to the `finally`, which must still remove the sandbox when it fails.
  const throwing = async () => {
    throw new Error('runner broke');
  };
  for (const run of [stubRun().run, unreadableHelp, throwing])
    await withJudge(async ({ call, ledgerFile, tmpRoot }) => {
      const restore = failSettleRows();
      try {
        await assert.rejects(() => call({ run }), /ENOSPC/);
      } finally {
        restore();
      }
      assert.deepEqual(
        rowsOf(ledgerFile).map((row) => row.type),
        ['reserve'],
        'the settle is tried once, so no "already settled" error replaces the real one',
      );
      assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the sandbox is removed');
    });
});

test('ledger: a failed sandbox after the reservation cancels it at $0 and throws the error', async () => {
  await withJudge(async ({ dir, call, ledgerFile }) => {
    const { run, calls } = stubRun();
    await assert.rejects(
      () => call({ run, tmpRoot: path.join(dir, 'no-such-folder') }),
      /ENOENT/,
    );
    assert.equal(calls.length, 0);
    const rows = rowsOf(ledgerFile);
    assert.deepEqual(
      rows.map((row) => [row.type, row.status, row.usd]),
      [
        ['reserve', undefined, ceilingUsd(OPUS)],
        ['settle', 'cancelled', 0],
      ],
    );
    assert.equal(rows[1].id, rows[0].id);
  });
});

test('ledger: token counts that are all 0 are not usage; the call is charged its mean, not the reported $0', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun((entry) =>
      entry.args[0] === 'run'
        ? { stdout: judgeTrace({ tokens: { input: 0, output: 0 }, cost: 0 }) }
        : { code: 1, stdout: '' },
    );
    const result = await call({ run });
    assert.equal(result.ok, true);
    assert.equal(result.usageSource, 'char-estimate');
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, OPUS_JUDGE.mean);
    assert.equal(settle.cost_source, 'estimate');
  });
});

test('ledger: a call that reports far more than it reserved is charged what it reported, and the next call is refused', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledgerFile = path.join(dir, 'out', 'ledger.jsonl');
    const ledger = createLedger({
      file: ledgerFile,
      limits: { max_usd: 0.1, total_cap_usd: 0.2 },
      runId: 'test',
    });
    const call = (run) =>
      oc.judgeCall({
        ledger,
        config: CONFIG,
        modelId: OPUS,
        prompt: 'judge this',
        label: 'test/judge',
        tmpRoot: dir,
        baseEnv: { PATH: process.env.PATH, HOME: dir },
        // A small output limit, so the call's ceiling fits under both limits and the call can start.
        maxOutputTokens: 256,
        run,
      });
    assert.ok(
      ceilingUsd(OPUS, 'judge this', 256) < 0.1,
      'the first call fits under both limits',
    );
    const { run } = stubRun(() => ({ stdout: judgeTrace({ cost: 5 }) }));
    const result = await call(run);
    assert.equal(result.ok, true);
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.usd, 5);
    assert.equal(settle.cost_source, 'reported');
    assert.ok(
      Math.abs(
        settle.over_reservation_usd - (5 - ceilingUsd(OPUS, 'judge this', 256)),
      ) < 1e-9,
    );
    await assert.rejects(() => call(run), /SPEND STOP/);
  });
});

test('errors: a trace error is cut at 400 characters, stderr at 2000, and an exit error text at 400', async () => {
  await withJudge(async ({ call }) => {
    const cut = (letter, kept, total) =>
      `${letter.repeat(kept)}[truncated ${total - kept} characters]`;
    const { run } = stubRun(() => ({
      stdout: line('error', undefined, {
        error: { message: 'x'.repeat(10000) },
      }),
      code: 1,
      stderr: 'y'.repeat(10000),
    }));
    const traceFailure = await call({ run });
    assert.equal(traceFailure.error, cut('x', 400, 10000));
    assert.equal(traceFailure.stderr, cut('y', 2000, 10000));
    const exited = await call({
      run: stubRun(() => ({ stdout: '', code: 2, stderr: 'y'.repeat(10000) }))
        .run,
    });
    assert.equal(exited.error, `exit 2: ${cut('y', 400, 10000)}`);
  });
});

test('judgeCall: a full reply with a non-zero exit code is a failed call', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({
      stdout: judgeTrace(),
      code: 1,
      stderr: 'late failure',
    }));
    const result = await call({ run });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'exit 1: late failure');
    assert.equal(result.text, REPLY);
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.status, 'failed');
    assert.equal(settle.usd, 0.01, 'the reported cost is still charged');
  });
});

test('session export: it is asked for the first session id of the stream, and only for a well-formed one', async () => {
  const textEvent = (sessionID) =>
    JSON.stringify({
      type: 'text',
      sessionID,
      part: { type: 'text', text: REPLY },
    });
  const exportable = (stdout) =>
    stubRun((entry) =>
      entry.args[0] === 'run' ? { stdout } : { code: 1, stdout: '' },
    );
  await withJudge(async ({ call }) => {
    const first = exportable(
      [
        line('step_start', { type: 'step-start' }),
        textEvent('ses_second'),
      ].join('\n'),
    );
    await call({ run: first.run });
    assert.deepEqual(first.calls[1].args.slice(0, 2), ['session', 'export']);
    assert.equal(first.calls[1].args.at(-1), 'ses_stub1', 'the first id');
    for (const bad of [
      'ses_a; touch x',
      'ses_a-b',
      `ses_${'a'.repeat(101)}`,
      'not_a_session',
    ]) {
      const refused = exportable(textEvent(bad));
      await call({ run: refused.run });
      assert.equal(refused.calls.length, 1, `no export for ${bad}`);
    }
    const longest = `ses_${'a'.repeat(100)}`;
    const accepted = exportable(textEvent(longest));
    await call({ run: accepted.run });
    assert.equal(accepted.calls[1].args.at(-1), longest);
  });
});

test('judgeCall: exported secrets shorter than the redactor minimum are left to the patterns and do not fail the call', async () => {
  await withJudge(async ({ call }) => {
    const credentials = {
      accessKeyId: 'ASIAEXAMPLEEXAMPLE01',
      secretAccessKey: 'short-7',
      sessionToken: 'tok-7',
    };
    const { run } = stubRun(() => ({ stdout: '', code: 2, stderr: 'boom' }));
    const result = await call({ run, credentials });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'exit 2: boom');
  });
});

test('readOpenCodeVersion: a non-zero exit code is refused even when a version is printed', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const run = async () => ({
      code: 1,
      stdout: '1.2.3\n',
      stderr: 'crashed',
      ms: 1,
      timedOut: false,
    });
    await assert.rejects(
      () => oc.readOpenCodeVersion({ region: 'us-west-2', run, tmpRoot: dir }),
      /cannot read the OpenCode version \(exit 1\): crashed/,
    );
  });
});

test('sandbox: a sandbox still in use when the process exits is removed by the exit hook', () => {
  helpers.withTmp((dir) => {
    const host = `
      const oc = require(${JSON.stringify(require.resolve('../../../scripts/bench/lib/opencode'))});
      const sandbox = oc.makeSandbox({ region: 'us-west-2', tmpRoot: ${JSON.stringify(dir)} });
      process.stdout.write(sandbox.root);
      process.exit(0);
    `;
    const result = spawnSync(process.execPath, ['-e', host], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith(path.join(dir, 'bench-judge-')));
    assert.ok(!fs.existsSync(result.stdout), 'the sandbox folder is gone');
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test('judgeCall: a help text cut off by a timeout is not trusted, even when it already names --format', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const calls = [];
    let helpAnswers = 0;
    const run = async (command, args) => {
      calls.push(args);
      if (isHelpCall(args)) {
        helpAnswers += 1;
        // The text printed before the kill names --format but not yet --standalone: an older OpenCode, cut short.
        return {
          code: null,
          stdout: HELP_WITHOUT_STANDALONE,
          stderr: '',
          ms: 30000,
          timedOut: true,
        };
      }
      return {
        code: 0,
        stdout: judgeTrace(),
        stderr: '',
        ms: 5,
        timedOut: false,
      };
    };
    const result = await call({ run });
    assert.equal(helpAnswers, 2, 'asked once more');
    assert.equal(result.ok, false);
    assert.equal(result.modelStarted, false);
    assert.match(
      result.error,
      /^cannot read `opencode run --help` \(timed out, 2 tries\)/,
    );
    assert.ok(
      calls.every((args) => isHelpCall(args)),
      'no judge process started on a guess',
    );
    assert.equal(
      rowsOf(ledgerFile).find((row) => row.type === 'settle').usd,
      0,
    );
  });
});

// ---- the output limit -------------------------------------------------------------------------------------------

test('judgeMaxOutputTokens: the seat entry, else the entry of the seat of the model, else the number; a model no seat uses gets the largest', () => {
  // The committed settings: 9000 for every seat, 5000 for openai, 37500 for xai.
  assert.equal(oc.judgeMaxOutputTokens(CONFIG, { seat: 'xai' }), 37500);
  assert.equal(oc.judgeMaxOutputTokens(CONFIG, { seat: 'openai' }), 5000);
  assert.equal(oc.judgeMaxOutputTokens(CONFIG, { seat: 'anthropic' }), 9000);
  const config = helpers.exampleConfig({
    judge_max_output_tokens: 7000,
    judge_max_output_tokens_by_seat: { openai: 5000, xai: 30000 },
  });
  // By seat.
  assert.equal(oc.judgeMaxOutputTokens(config, { seat: 'openai' }), 5000);
  assert.equal(oc.judgeMaxOutputTokens(config, { seat: 'xai' }), 30000);
  // A seat with no entry gets the number.
  assert.equal(oc.judgeMaxOutputTokens(config, { seat: 'anthropic' }), 7000);
  // The seat decides, not the model, when the two disagree.
  assert.equal(
    oc.judgeMaxOutputTokens(config, { seat: 'xai', modelId: OPUS }),
    30000,
  );
  assert.equal(
    oc.judgeMaxOutputTokens(config, { seat: 'anthropic', modelId: GROK }),
    7000,
  );
  // By the seat that owns the model: its entry, else the number.
  assert.equal(oc.judgeMaxOutputTokens(config, { modelId: OPUS }), 7000);
  assert.equal(oc.judgeMaxOutputTokens(config, { modelId: TERRA }), 5000);
  assert.equal(oc.judgeMaxOutputTokens(config, { modelId: GROK }), 30000);
  // A seat added later, with no entry, gets the number.
  const added = helpers.exampleConfig({
    judge_max_output_tokens: 7000,
    models: { judges: { newcomer: 'us.example.newcomer-1' } },
  });
  assert.equal(
    oc.judgeMaxOutputTokens(added, {
      seat: 'newcomer',
      modelId: 'us.example.newcomer-1',
    }),
    7000,
  );
  // Two seats on one model: with no seat given, the first of them decides.
  const twins = helpers.exampleConfig({
    judge_max_output_tokens: 7000,
    models: { judges: { zeta: OPUS } },
    judge_max_output_tokens_by_seat: { zeta: 3000 },
  });
  assert.equal(oc.judgeMaxOutputTokens(twins, { modelId: OPUS }), 7000);
  assert.equal(oc.judgeMaxOutputTokens(twins, { seat: 'zeta' }), 3000);
  // A checklist writer model that no seat uses may need what the longest-writing seat needs.
  assert.equal(
    oc.judgeMaxOutputTokens(config, { modelId: 'other.model' }),
    30000,
  );
  assert.equal(oc.judgeMaxOutputTokens(config, {}), 30000);
  // The number counts in the largest too, when it is the largest.
  const high = helpers.exampleConfig({
    judge_max_output_tokens: 40000,
    judge_max_output_tokens_by_seat: { openai: 5000, xai: 30000 },
  });
  assert.equal(
    oc.judgeMaxOutputTokens(high, { modelId: 'other.model' }),
    40000,
  );
  // With no entries at all the number is every limit.
  const plain = helpers.exampleConfig({
    judge_max_output_tokens_by_seat: { openai: null, xai: null },
  });
  assert.equal(
    oc.judgeMaxOutputTokens(plain, { modelId: 'other.model' }),
    9000,
  );
  assert.equal(oc.judgeMaxOutputTokens(plain, { seat: 'xai' }), 9000);
  // A seat name that is an Object.prototype key is not looked up there.
  assert.equal(
    oc.judgeMaxOutputTokens(config, { seat: 'constructor', modelId: OPUS }),
    7000,
  );
  assert.equal(
    oc.judgeMaxOutputTokens(config, {
      seat: 'toString',
      modelId: 'other.model',
    }),
    30000,
  );
  // A seat may be named after an Object.prototype key; its own entry or the number applies, never the prototype's.
  const named = helpers.exampleConfig({
    judge_max_output_tokens: 7000,
    models: { judges: { constructor: 'us.example.ctor-1' } },
    judge_max_output_tokens_by_seat: { openai: null, xai: null },
  });
  assert.equal(
    oc.judgeMaxOutputTokens(named, { modelId: 'us.example.ctor-1' }),
    7000,
  );
  assert.equal(oc.judgeMaxOutputTokens(named, { seat: 'constructor' }), 7000);
  // A config with no by-seat setting at all has the number for every seat.
  const handBuilt = {
    judge_max_output_tokens: 6000,
    models: { judges: { solo: 'm' } },
  };
  assert.equal(oc.judgeMaxOutputTokens(handBuilt, { seat: 'solo' }), 6000);
  assert.equal(oc.judgeMaxOutputTokens(handBuilt, { modelId: 'other' }), 6000);
  assert.throws(
    () => oc.judgeMaxOutputTokens({ models: { judges: {} } }, {}),
    /judge_max_output_tokens is required/,
  );
});

test('callCeiling: the prompt tokens plus the output limit at the model prices, rounded up to a millionth of a dollar', () => {
  for (const [modelId, kind] of [
    [OPUS, 'judge'],
    [OPUS, 'writer'],
    [GROK, 'judge'],
    [TERRA, 'judge'],
  ])
    for (const [prompt, limit] of [
      ['judge this', 37500],
      ['x'.repeat(3000), 256],
      ['é'.repeat(5000), 128000],
      ['y'.repeat(131071), 9000],
    ]) {
      const ceiling = oc.callCeiling({
        config: CONFIG,
        callKind: kind,
        modelId,
        prompt,
        maxOutputTokens: limit,
      });
      assert.equal(
        ceiling.usd,
        ceilingUsd(modelId, prompt, limit),
        `${modelId} ${kind} ${limit}`,
      );
      assert.equal(ceiling.ceiling, true);
      // The mean and the model's cliReportsLow still come from the profile, for the settlement.
      assert.equal(
        ceiling.options.meanUsd,
        callCost(CONFIG, kind, modelId).mean,
      );
      assert.equal(ceiling.options.cliReportsLow, modelId === TERRA);
      assert.equal(ceiling.options.kind, kind);
      assert.equal(ceiling.options.model, modelId);
    }
  // The default limit on a short prompt: the figures worked out by hand from the committed prices.
  assert.equal(ceilingUsd(OPUS, 'judge this', LIMIT), 0.220022);
  assert.equal(ceilingUsd(GROK, 'judge this', GROK_LIMIT), 0.256309);
  assert.equal(ceilingUsd(TERRA, 'judge this', TERRA_LIMIT), 0.033006);
});

test('callCeiling: a model with no token prices is reserved at its p90, with ceiling false', () => {
  const unpriced = {
    schemaVersion: 1,
    unit: 'usd',
    entries: [
      {
        kind: 'judge',
        model: OPUS,
        calls: 1,
        failed: 0,
        mean: 0.05,
        median: 0.05,
        p90: 0.07,
        cliReportsLow: false,
      },
    ],
  };
  const ceiling = oc.callCeiling({
    config: CONFIG,
    callKind: 'judge',
    modelId: OPUS,
    prompt: 'judge this',
    maxOutputTokens: 37500,
    costProfile: unpriced,
  });
  assert.equal(ceiling.usd, 0.07);
  assert.equal(ceiling.ceiling, false);
  const other = oc.callCeiling({
    config: CONFIG,
    callKind: 'judge',
    modelId: 'some.other-model',
    prompt: 'judge this',
    maxOutputTokens: 37500,
  });
  assert.equal(other.ceiling, false);
  assert.equal(other.usd, CONFIG.estimate_usd_per_call.judge * 1.5);
});

test('judgeCall: the reservation equals the ceiling and the sandbox config carries the same output limit', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run, calls } = stubRun();
    const prompt = 'z'.repeat(9000);
    await call({ run, prompt });
    await call({ run, prompt, maxOutputTokens: 4000, modelId: GROK });
    await call({ run, prompt, seat: 'xai', modelId: TERRA });
    const reserves = rowsOf(ledgerFile).filter((row) => row.type === 'reserve');
    assert.deepEqual(
      reserves.map((row) => row.usd),
      [
        ceilingUsd(OPUS, prompt, 9000),
        ceilingUsd(GROK, prompt, 4000),
        ceilingUsd(TERRA, prompt, 37500),
      ],
    );
    const entryOf = (recorded, entry) =>
      recorded.config.provider['amazon-bedrock'].models[entry];
    assert.equal(entryOf(calls[0], OPUS_ENTRY).limit.output, 9000);
    assert.equal(entryOf(calls[1], GROK_ENTRY).limit.output, 4000);
    assert.equal(entryOf(calls[1], GROK_ENTRY).settings.maxTokens, 4000);
    assert.equal(entryOf(calls[2], TERRA_ENTRY).limit.output, 37500);
  });
});

test('judgeCall: each seat gets its own limit, else the number, and so its own reservation', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const config = helpers.exampleConfig({
      judge_max_output_tokens: 7000,
      judge_max_output_tokens_by_seat: { openai: 5000, xai: 20000 },
    });
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    const ledger = createLedger({
      file: ledgerFile,
      limits: { max_usd: 25, total_cap_usd: 100 },
      runId: 'test',
    });
    const { run, calls } = stubRun();
    for (const [seat, modelId] of [
      ['anthropic', OPUS],
      ['openai', TERRA],
      ['xai', GROK],
    ])
      await oc.judgeCall({
        ledger,
        config,
        modelId,
        seat,
        prompt: 'judge this',
        label: seat,
        tmpRoot: dir,
        baseEnv: { PATH: process.env.PATH, HOME: dir },
        run,
      });
    assert.deepEqual(
      rowsOf(ledgerFile)
        .filter((row) => row.type === 'reserve')
        .map((row) => row.usd),
      [
        ceilingUsd(OPUS, 'judge this', 7000),
        ceilingUsd(TERRA, 'judge this', 5000),
        ceilingUsd(GROK, 'judge this', 20000),
      ],
    );
    assert.deepEqual(
      calls.map(
        (entry) =>
          Object.values(entry.config.provider['amazon-bedrock'].models)[0].limit
            .output,
      ),
      [7000, 5000, 20000],
    );
  });
});

test('judgeCall: an output limit outside 256 to 128000 is refused before any reservation or process', async () => {
  await withJudge(async ({ call, ledgerFile, tmpRoot }) => {
    const { run, calls } = stubRun();
    for (const bad of [255, 128001, 0, -1, 1000.5, '5000', NaN, Infinity])
      await assert.rejects(
        () => call({ run, maxOutputTokens: bad }),
        /maxOutputTokens must be a whole number from 256 to 128000/,
        String(bad),
      );
    assert.equal(calls.length, 0);
    assert.deepEqual(rowsOf(ledgerFile), []);
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
    // A config with no output limit is refused too, rather than a call that has none.
    await assert.rejects(
      () =>
        call({
          run,
          config: { ...CONFIG, judge_max_output_tokens: undefined },
        }),
      /judge_max_output_tokens is required/,
    );
  });
});

test('judgeCall: a call whose ceiling does not fit under max_usd is refused before a process starts', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const ledger = createLedger({
      file: path.join(dir, 'ledger.jsonl'),
      limits: { max_usd: 0.5, total_cap_usd: 0.5 },
      runId: 'test',
    });
    const { run, calls } = stubRun();
    const attempt = (maxOutputTokens) =>
      oc.judgeCall({
        ledger,
        config: CONFIG,
        modelId: OPUS,
        maxOutputTokens,
        prompt: 'judge this',
        label: 'x',
        tmpRoot: dir,
        baseEnv: { PATH: process.env.PATH, HOME: dir },
        run,
      });
    // Its p90 is 0.07, far under the limit, but the ceiling at the default output limit is 0.85.
    await assert.rejects(() => attempt(37500), /SPEND STOP/);
    assert.equal(calls.length, 0);
    assert.equal((await attempt(9000)).ok, true);
  });
});

test('judgeCall: a reply the model stopped for length is a failed call that the retry sorts as transient', async () => {
  await withJudge(async ({ call, ledgerFile }) => {
    const { run } = stubRun(() => ({
      stdout: judgeTrace({
        text: '{"items":["MET","MI',
        tokens: { input: 1000, output: 9000 },
        reason: 'length',
      }),
    }));
    const result = await call({ run, maxOutputTokens: 9000 });
    assert.equal(result.ok, false);
    assert.equal(result.cutOff, true);
    assert.equal(result.maxOutputTokens, 9000);
    assert.equal(
      result.error,
      'reply cut off at the output limit of 9000 tokens (judge_max_output_tokens or judge_max_output_tokens_by_seat); the reply is not used',
    );
    assert.equal(classifyError(oc.judgeCallError(result)), 'transient');
    // The call was paid for, and is charged what it reported.
    const settle = rowsOf(ledgerFile).find((row) => row.type === 'settle');
    assert.equal(settle.status, 'failed');
    assert.equal(settle.cost_source, 'reported');
    assert.equal(settle.usd, 0.01);
  });
});

test('judgeCall: cutOff is true for a reply that used the whole limit and false for one that did not, with ok unchanged', async () => {
  await withJudge(async ({ call }) => {
    const reply = (tokens, reason) =>
      stubRun(() => ({
        stdout: judgeTrace({ tokens: { input: 1000, output: tokens }, reason }),
      })).run;
    const full = await call({
      run: reply(5000, 'stop'),
      maxOutputTokens: 5000,
    });
    assert.equal(
      full.ok,
      true,
      'a reply that ended on its own is read by the parser',
    );
    assert.equal(full.cutOff, true);
    const over = await call({
      run: reply(5001, 'stop'),
      maxOutputTokens: 5000,
    });
    assert.equal(over.cutOff, true);
    const under = await call({
      run: reply(4999, 'stop'),
      maxOutputTokens: 5000,
    });
    assert.equal(under.ok, true);
    assert.equal(under.cutOff, false);
    const noReason = await call({
      run: reply(200, undefined),
      maxOutputTokens: 5000,
    });
    assert.equal(noReason.ok, true);
    assert.equal(noReason.cutOff, false);
    const toolCalls = await call({
      run: reply(200, 'tool-calls'),
      maxOutputTokens: 5000,
    });
    assert.equal(toolCalls.ok, true);
    assert.equal(toolCalls.cutOff, false);
    // A failed call that is not a cut-off says so.
    const failed = await call({
      run: stubRun(() => ({ stdout: '', code: 1, stderr: 'boom' })).run,
      maxOutputTokens: 5000,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.cutOff, false);
  });
});

test('judgeCall: the seat decides the limit, not the model, when the two disagree', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const config = helpers.exampleConfig({
      judge_max_output_tokens_by_seat: { openai: 5000, xai: 20000 },
    });
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    const ledger = createLedger({
      file: ledgerFile,
      limits: { max_usd: 25, total_cap_usd: 100 },
      runId: 'test',
    });
    const { run, calls } = stubRun();
    // The xai seat is given the model of the anthropic seat: the seat's own limit applies.
    await oc.judgeCall({
      ledger,
      config,
      modelId: OPUS,
      seat: 'xai',
      prompt: 'judge this',
      label: 'x',
      tmpRoot: dir,
      baseEnv: { PATH: process.env.PATH, HOME: dir },
      run,
    });
    assert.equal(
      rowsOf(ledgerFile).find((row) => row.type === 'reserve').usd,
      ceilingUsd(OPUS, 'judge this', 20000),
    );
    assert.equal(
      calls[0].config.provider['amazon-bedrock'].models[OPUS_ENTRY].limit
        .output,
      20000,
    );
  });
});
