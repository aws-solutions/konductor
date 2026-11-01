// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { makeFakeOpencodeJudge } = require('./fake-opencode-judge.js');
const { makeOpencodeCaller } = require('../../judge/opencode.js');
const { JUDGE_SYSTEM_PROMPT, systemPromptSha256, opencodeModel, OPENCODE_MODELS, checkOpencodeJudges } = require('../../judge/backends.js');

const SECRETS = ['AKIATESTSECRET0001', 'SECRETVALUE-xyz', 'TOKENVALUE-abc'];
const CREDS = `[other]\naws_access_key_id = AKIAOTHERPROFILE\naws_secret_access_key = OTHERSECRET\n\n[bench]\naws_access_key_id = ${SECRETS[0]}\naws_secret_access_key = ${SECRETS[1]}\naws_session_token = ${SECRETS[2]}\n`;
const RUBRIC_PROMPT = 'Grade.\n- id: c1\n- id: c2\nReply with JSON.';

function setup(config = {}, opts = {}) {
  const root = tmp();
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  const fake = makeFakeOpencodeJudge(path.join(root, 'bin'), { dir: path.join(root, 'calls'), ...config });
  const creds = path.join(root, 'creds');
  fs.writeFileSync(creds, CREDS);
  const sleeps = [];
  const mk = (o = {}) => makeOpencodeCaller({
    bin: fake.file, credsFile: creds, awsProfile: 'bench', region: 'us-east-1', timeoutMs: 20000, scratchRoot: scratch,
    backoffMs: 100, maxAttempts: 4, sleep: async (ms) => { sleeps.push(ms); }, ...opts, ...o,
  });
  const calls = () => (fs.existsSync(path.join(root, 'calls')) ? fake.calls() : []);
  return { root, scratch, fake, creds, sleeps, mk, calls, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('each logical panel id maps to its Bedrock id, agent and temperature setting', () => {
  assert.deepEqual(Object.keys(OPENCODE_MODELS).sort(), ['deepseek-3.2', 'glm-5', 'gpt-5.6-luna', 'minimax-m2.5', 'qwen3-coder-next']);
  const m = (l) => { const x = opencodeModel(l); return [x.bedrockId, x.agent, x.temperature]; };
  assert.deepEqual(m('gpt-5.6-luna'), ['global.openai.gpt-5.6-luna', 'judge-notemp', null]);
  assert.deepEqual(m('deepseek-3.2'), ['deepseek.v3.2', 'judge', 0]);
  assert.deepEqual(m('glm-5'), ['zai.glm-5', 'judge', 0]);
  assert.deepEqual(m('qwen3-coder-next'), ['qwen.qwen3-coder-next', 'judge', 0]);
  assert.deepEqual(m('minimax-m2.5'), ['minimax.minimax-m2.5', 'judge', 0]);
});

test('a judge with no Bedrock mapping is refused with the known ids, and a raw Bedrock id points to the logical id', () => {
  assert.throws(() => opencodeModel('gpt-test'), /no Bedrock mapping.*gpt-test.*gpt-5\.6-luna, deepseek-3\.2/s);
  assert.throws(() => checkOpencodeJudges(['gpt-5.6-luna', 'deepseek.v3.2']), /deepseek\.v3\.2.*use the panel id "deepseek-3\.2"/s);
  assert.doesNotThrow(() => checkOpencodeJudges(['gpt-5.6-luna', 'deepseek-3.2', 'glm-5']));
});

test('the system prompt is the fixed one-liner and its hash is a sha256 of exactly that text', () => {
  assert.equal(JUDGE_SYSTEM_PROMPT, 'You are an evaluator. Reply only with the JSON object the user asks for.');
  assert.match(systemPromptSha256(), /^[0-9a-f]{64}$/);
  assert.equal(systemPromptSha256(), require('node:crypto').createHash('sha256').update(JUDGE_SYSTEM_PROMPT).digest('hex'));
});

test('request and agent selection: temperature-0 agent for deepseek and glm, the no-temperature agent for luna', async () => {
  const s = setup();
  try {
    const caller = s.mk();
    for (const model of ['deepseek-3.2', 'glm-5', 'gpt-5.6-luna']) {
      const r = await caller({ model, prompt: RUBRIC_PROMPT });
      assert.equal(r.error, undefined, r.error);
    }
    const [ds, glm, luna] = s.calls();
    const arg = (c, flag) => c.args[c.args.indexOf(flag) + 1];
    assert.equal(ds.args[0], 'run');
    assert.deepEqual([arg(ds, '--agent'), arg(ds, '-m'), arg(ds, '--format')], ['judge', 'amazon-bedrock/deepseek.v3.2', 'json']);
    assert.deepEqual([arg(glm, '--agent'), arg(glm, '-m')], ['judge', 'amazon-bedrock/zai.glm-5']);
    assert.deepEqual([arg(luna, '--agent'), arg(luna, '-m')], ['judge-notemp', 'amazon-bedrock/global.openai.gpt-5.6-luna']);

    const cfg = (c) => JSON.parse(c.config);
    const d = cfg(ds);
    assert.equal(d.agent.judge.temperature, 0);
    assert.equal(d.provider['amazon-bedrock'].models['deepseek.v3.2'].temperature, true, 'the model must be allowed to take a temperature, or opencode drops it');
    const l = cfg(luna);
    assert.equal('temperature' in l.agent['judge-notemp'], false);
    assert.equal(l.provider['amazon-bedrock'].models['global.openai.gpt-5.6-luna'].temperature, false);
    for (const c of [ds, glm, luna]) {
      const name = arg(c, '--agent');
      const agents = cfg(c).agent;
      assert.equal(agents[name].prompt, JUDGE_SYSTEM_PROMPT);
      assert.deepEqual(agents[name].tools, { '*': false });
      assert.deepEqual(agents[name].permission, { '*': 'deny' });
      const custom = Object.keys(agents).filter((k) => !agents[k].disable);
      assert.deepEqual(custom, [name], 'no agent other than the judge agent is enabled');
      const o = cfg(c).provider['amazon-bedrock'].options;
      assert.deepEqual([o.region, o.profile], ['us-east-1', 'bench']);
      assert.deepEqual(cfg(c).enabled_providers, ['amazon-bedrock']);
      assert.equal(Object.keys(cfg(c).provider['amazon-bedrock'].models).length, 1, 'only the model of this call is declared');
    }
  } finally { s.cleanup(); }
});

test('the prompt arrives unchanged on stdin, never in argv, even past the argv size limit', async () => {
  const s = setup();
  try {
    const big = `${RUBRIC_PROMPT}\n${'é'.repeat(200000)}\nend`;
    const r = await s.mk()({ model: 'glm-5', prompt: big });
    assert.equal(r.error, undefined, r.error);
    const [c] = s.calls();
    assert.equal(c.prompt, big);
    assert.ok(c.args.every((a) => !a.includes('Grade.')));
    assert.deepEqual(c.args, ['run', '--dir', c.cwd, '--agent', 'judge', '-m', 'amazon-bedrock/zai.glm-5', '--format', 'json', '--title', 'bench'], 'no positional message and no --auto');
  } finally { s.cleanup(); }
});

test('a normal reply is returned with tokens and USD from the session database, and zero credits', async () => {
  const s = setup({ cost: 0.0123, tokens: { input: 900, output: 40, reasoning: 7, cacheRead: 5, cacheWrite: 3 } });
  try {
    const r = await s.mk()({ model: 'deepseek-3.2', prompt: RUBRIC_PROMPT });
    assert.deepEqual(JSON.parse(r.text).criteria.map((c) => c.id), ['c1', 'c2']);
    assert.equal(r.credits, 0);
    assert.equal(r.usd, 0.0123);
    assert.deepEqual(r.tokens, { input: 900, output: 40, reasoning: 7, cacheRead: 5, cacheWrite: 3 });
    assert.equal(r.usageSource, 'db');
    assert.equal(r.bedrockModelId, 'deepseek.v3.2');
    assert.equal(r.retries, 0);
    assert.equal(typeof r.latencyMs, 'number');
  } finally { s.cleanup(); }
});

test('without the database the stream totals are used and marked as such', async () => {
  const s = setup({ mode: 'nodb', cost: 0.02 });
  try {
    const r = await s.mk()({ model: 'glm-5', prompt: RUBRIC_PROMPT });
    assert.equal(r.error, undefined);
    assert.equal(r.usageSource, 'stream');
    assert.equal(r.usd, 0.02);
    assert.equal(r.tokens.output, 20);
  } finally { s.cleanup(); }
});

test('a reply that is not JSON still comes back as text; the caller does not judge it', async () => {
  const s = setup({ mode: 'prose' });
  try {
    const r = await s.mk()({ model: 'glm-5', prompt: RUBRIC_PROMPT });
    assert.equal(r.text, 'I think it is fine.');
    assert.equal(r.error, undefined);
  } finally { s.cleanup(); }
});

test('isolation: own scratch HOME and cwd, allow-listed env, only the named credentials profile, nothing left behind', async () => {
  const s = setup();
  const planted = { KRB5CCNAME: '/tmp/krb5cc_x', SSO_TOKEN: 'sso', AWS_ACCESS_KEY_ID: 'AKIAENVLEAK', AWS_SESSION_TOKEN: 'envtoken', KIRO_API_KEY: 'k', BENCH_JUDGE_CMD: 'x', SSH_AUTH_SOCK: '/tmp/agent' };
  const saved = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const r = await s.mk()({ model: 'deepseek-3.2', prompt: RUBRIC_PROMPT });
    assert.equal(r.error, undefined, r.error);
    const [c] = s.calls();
    assert.notEqual(c.home, os.homedir());
    assert.ok(c.home.startsWith(s.scratch + path.sep), `HOME ${c.home} is not under the scratch root`);
    assert.ok(c.cwd.startsWith(s.scratch + path.sep));
    assert.notEqual(c.cwd, process.cwd());
    for (const k of Object.keys(planted)) assert.equal(c.env[k], undefined, `${k} leaked into the judge process`);
    for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR']) assert.ok(c.env[k].startsWith(c.home) || c.env[k].startsWith(s.scratch), `${k} is outside the scratch root`);
    assert.equal(c.env.AWS_PROFILE, 'bench');
    assert.equal(c.env.AWS_REGION, 'us-east-1');
    assert.equal(c.env.AWS_SHARED_CREDENTIALS_FILE, path.join(c.home, '.aws', 'credentials'));
    assert.deepEqual(c.credHeaders, ['[bench]'], 'only the named profile is copied');
    assert.equal(c.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
    assert.equal(c.env.OPENCODE_DISABLE_AUTOUPDATE, '1');
    assert.deepEqual(fs.readdirSync(s.scratch), [], 'the scratch dir (with the credentials copy) is gone');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    s.cleanup();
  }
});

test('scratch and the credentials copy are removed after a crash, a timeout and an exhausted retry', async () => {
  for (const [mode, timeoutMs] of [['crash', 20000], ['sleep', 400], ['throttle', 20000], ['empty', 20000]]) {
    const s = setup({ mode });
    try {
      const r = await s.mk({ timeoutMs, maxAttempts: 2 })({ model: 'glm-5', prompt: RUBRIC_PROMPT });
      assert.ok(r.error, `${mode} should be an error`);
      assert.deepEqual(fs.readdirSync(s.scratch), [], `${mode}: scratch left behind`);
    } finally { s.cleanup(); }
  }
});

test('parallel calls get separate scratch homes', async () => {
  const s = setup();
  try {
    const caller = s.mk();
    await Promise.all([1, 2, 3].map(() => caller({ model: 'glm-5', prompt: RUBRIC_PROMPT })));
    const homes = s.calls().map((c) => c.home);
    assert.equal(new Set(homes).size, 3);
    assert.deepEqual(fs.readdirSync(s.scratch), []);
  } finally { s.cleanup(); }
});

test('a throttled call is retried with exponential backoff and counts its retries', async () => {
  const s = setup({ modes: ['throttle', 'throttle', 'good'] });
  try {
    const r = await s.mk()({ model: 'deepseek-3.2', prompt: RUBRIC_PROMPT });
    assert.equal(r.error, undefined, r.error);
    assert.equal(s.calls().length, 3);
    assert.deepEqual(s.sleeps, [100, 200]);
    assert.equal(r.retries, 2);
    assert.equal(r.throttled, 2);
    assert.equal(r.usd, 0.01, 'a failed attempt costs nothing; only the answered one is counted');
  } finally { s.cleanup(); }
});

test('backoff is capped and gives up after maxAttempts with a throttling message', async () => {
  const s = setup({ mode: 'throttle' });
  try {
    const r = await s.mk({ maxAttempts: 4, backoffMs: 1000, maxBackoffMs: 2500 })({ model: 'deepseek-3.2', prompt: RUBRIC_PROMPT });
    assert.match(r.error, /throttl.*4 attempts/i);
    assert.equal(s.calls().length, 4);
    assert.deepEqual(s.sleeps, [1000, 2000, 2500]);
    assert.equal(r.text, '');
  } finally { s.cleanup(); }
});

test('errors that are not throttling are not retried and are mapped to clear messages', async () => {
  const cases = [
    ['crash', /opencode exit 3.*boom/s],
    ['auth', /credentials were rejected.*ExpiredToken/s],
    ['tool', /used a tool.*bash/s],
    ['empty', /no reply/],
    ['wrongmodel', /served model "some\.other-model".*expected "deepseek\.v3\.2"/s],
  ];
  for (const [mode, re] of cases) {
    const s = setup({ mode });
    try {
      const r = await s.mk()({ model: 'deepseek-3.2', prompt: RUBRIC_PROMPT });
      assert.match(r.error, re, mode);
      assert.equal(s.calls().length, 1, `${mode} must not be retried`);
      assert.equal(r.text, '');
    } finally { s.cleanup(); }
  }
});

test('a call that outlives its timeout is killed and reported', async () => {
  const s = setup({ mode: 'sleep' });
  try {
    const r = await s.mk({ timeoutMs: 400 })({ model: 'glm-5', prompt: RUBRIC_PROMPT });
    assert.match(r.error, /timed out after 400 ms/);
    assert.equal(s.calls().length, 1);
  } finally { s.cleanup(); }
});

test('no credential value reaches the kept raw output or an error message', async () => {
  const s = setup({ mode: 'leak' });
  const rawDir = path.join(s.root, 'raw');
  try {
    const ok = await s.mk({ rawDir })({ model: 'glm-5', prompt: RUBRIC_PROMPT });
    assert.equal(ok.error, undefined);
    s.fake.setConfig({ mode: 'crash' });
    const bad = await s.mk({ rawDir })({ model: 'glm-5', prompt: RUBRIC_PROMPT });
    const kept = fs.readdirSync(rawDir);
    assert.ok(kept.length >= 1);
    for (const f of kept) {
      const text = fs.readFileSync(path.join(rawDir, f), 'utf8');
      for (const secret of SECRETS) assert.ok(!text.includes(secret), `${f} holds a credential value`);
    }
    for (const secret of SECRETS) assert.ok(!bad.error.includes(secret));
  } finally { s.cleanup(); }
});

test('the caller refuses a missing credentials file or profile up front, without echoing values', () => {
  const s = setup();
  try {
    assert.throws(() => s.mk({ credsFile: path.join(s.root, 'nope') }), /cannot read the credentials file/);
    assert.throws(() => s.mk({ awsProfile: 'missing' }), /profile "missing" not found/);
    try { s.mk({ awsProfile: 'missing' }); } catch (e) { for (const secret of SECRETS) assert.ok(!e.message.includes(secret)); }
  } finally { s.cleanup(); }
});

test('a judge with no mapping is an error result, not a crash', async () => {
  const s = setup();
  try {
    const r = await s.mk()({ model: 'gpt-test', prompt: RUBRIC_PROMPT });
    assert.match(r.error, /no Bedrock mapping/);
    assert.equal(s.calls().length, 0);
  } finally { s.cleanup(); }
});

test('the caller describes itself for judgments.json', () => {
  const s = setup({ version: '1.19.5' });
  try {
    const info = s.mk().info;
    assert.equal(info.backend, 'opencode');
    assert.equal(info.opencodeVersion, '1.19.5');
    assert.equal(info.region, 'us-east-1');
    assert.equal(info.systemPromptSha256, systemPromptSha256());
    assert.equal(info.systemPrompt, JUDGE_SYSTEM_PROMPT);
    assert.deepEqual(Object.keys(info.models(['gpt-5.6-luna', 'glm-5'])), ['gpt-5.6-luna', 'glm-5']);
    assert.deepEqual(info.models(['gpt-5.6-luna'])['gpt-5.6-luna'], { bedrockModelId: 'global.openai.gpt-5.6-luna', agent: 'judge-notemp', temperature: null, temperatureApplied: false });
    assert.deepEqual(info.models(['glm-5'])['glm-5'], { bedrockModelId: 'zai.glm-5', agent: 'judge', temperature: 0, temperatureApplied: true });
  } finally { s.cleanup(); }
});
