// SPDX-License-Identifier: Apache-2.0
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { createRegistry, pluginPathRoots } = require('../core/registry.js');

// Which program asks the judge model. `kiro` is the default and the only one that existed before; `opencode` calls
// the model on Amazon Bedrock through `opencode run` with the tools off and a one-line system prompt. More backends come
// from bench/plugins as registry parts of kind `judge-backend` (FW-14): a descriptor `{ id, costUnit, label }` and an
// entry module exporting `makeCaller({ timeoutMs, rawDir, log })`, which returns an async ({model, prompt}) caller.
// The opencode backend's id, for the code that treats it apart (its prompt cap, cache records and caller).
const OPENCODE_BACKEND = 'opencode';
const BUILTIN_BACKENDS = Object.freeze([
  Object.freeze({ id: 'kiro', costUnit: 'credits', label: 'kiro-cli, spend in credits' }),
  Object.freeze({ id: OPENCODE_BACKEND, costUnit: 'usd', label: 'opencode on Bedrock, spend in USD' }),
]);
const DEFAULT_BACKEND = 'kiro';
const PLUGINS_DIR = path.resolve(__dirname, '..', 'plugins');

/**
 * The judge backends over the built-ins and the judge-backend plugins under `pluginRoots` (default bench/plugins and
 * the BENCH_PLUGIN_PATH roots): `ids()` in order,
 * `part(id)` the registry part (or undefined), `usdIds()` the backends that count spend in USD.
 */
function backendRegistry(pluginRoots = [PLUGINS_DIR, ...pluginPathRoots()]) {
  const reg = createRegistry({ builtins: BUILTIN_BACKENDS.map((meta) => ({ kind: 'judge-backend', meta })), pluginRoots });
  const parts = reg.parts('judge-backend');
  return Object.freeze({
    ids: () => parts.map((p) => p.name),
    part: (id) => parts.find((p) => p.name === id),
    usdIds: () => parts.filter((p) => p.meta.costUnit === 'usd').map((p) => p.name),
    refused: () => reg.refused(),
  });
}

let defaultRegistry = null;
const registryOf = (given) => given ?? (defaultRegistry ??= backendRegistry());
const orList = (xs) => xs.join(' or ');

/**
 * The one check of a judge backend and its budget flag (judge/run.js, judge/packrun.js, the judge CLI). Throws on an
 * unknown backend and on the budget of the other unit. Returns `{ backend, usdMode, unit, part }`.
 */
function checkBackend({ backend = DEFAULT_BACKEND, budgetCredits = null, budgetUsd = null } = {}, registry = null) {
  const reg = registryOf(registry);
  const part = reg.part(backend);
  if (!part) throw new Error(`unknown judge backend "${backend}": --judge-backend takes ${orList(reg.ids())}`);
  const usdMode = part.meta.costUnit === 'usd';
  if (usdMode && budgetCredits != null) throw new Error(`--budget-credits does not apply to the ${backend} backend; use --budget-usd`);
  if (!usdMode && budgetUsd != null) throw new Error(`--budget-usd applies to the ${orList(reg.usdIds())} backend only; use --budget-credits`);
  return { backend, usdMode, unit: usdMode ? 'usd' : 'credits', part };
}

/** The caller of a plugin backend `part`, from its entry module's makeCaller(opts). Built-ins are built by the CLI. */
function makeBackendCaller(part, opts) {
  const mod = require(part.plugin.entry);
  if (typeof mod.makeCaller !== 'function') throw new Error(`judge backend ${part.name}: its entry module exports no makeCaller`);
  return mod.makeCaller(opts);
}

/** The ids of every judge backend this bench can use, built-ins first. */
const BACKENDS = Object.freeze(registryOf(null).ids());

const JUDGE_SYSTEM_PROMPT = 'You are an evaluator. Reply only with the JSON object the user asks for.';
const systemPromptSha256 = () => crypto.createHash('sha256').update(JUDGE_SYSTEM_PROMPT).digest('hex');

// Panel ids stay the logical names used everywhere else (family checks run on them). `temperature: null` means the
// model rejects the field on Bedrock, so the no-temperature agent is used and nothing is sent.
// `limit` is opencode's context and output cap for the model; the output cap is far above the longest reply seen.
const OPENCODE_MODELS = {
  'gpt-5.6-luna': { bedrockId: 'global.openai.gpt-5.6-luna', temperature: null, limit: { context: 900000, output: 8000 } },
  'deepseek-3.2': { bedrockId: 'deepseek.v3.2', temperature: 0, limit: { context: 160000, output: 8000 } },
  'glm-5': { bedrockId: 'zai.glm-5', temperature: 0, limit: { context: 200000, output: 8000 } },
  'qwen3-coder-next': { bedrockId: 'qwen.qwen3-coder-next', temperature: 0, limit: { context: 200000, output: 8000 } },
  'minimax-m2.5': { bedrockId: 'minimax.minimax-m2.5', temperature: 0, limit: { context: 200000, output: 8000 } },
};

const known = () => Object.keys(OPENCODE_MODELS).join(', ');

function opencodeModel(logical) {
  const m = OPENCODE_MODELS[logical];
  if (!m) throw new Error(`no Bedrock mapping for judge "${logical}" on the opencode backend (known panel ids: ${known()})`);
  return { logical, ...m, agent: m.temperature === null ? 'judge-notemp' : 'judge' };
}

// A raw Bedrock id would pass the family check under another family name (zai.glm-5 is "zai", glm-5 is "glm").
function checkOpencodeJudges(judges) {
  for (const j of judges) {
    const logical = Object.keys(OPENCODE_MODELS).find((k) => OPENCODE_MODELS[k].bedrockId === j);
    if (logical) throw new Error(`judge "${j}" is a Bedrock model id; use the panel id "${logical}" (the backend maps it)`);
    opencodeModel(j);
  }
}

module.exports = { BACKENDS, BUILTIN_BACKENDS, DEFAULT_BACKEND, OPENCODE_BACKEND, backendRegistry, checkBackend, makeBackendCaller, JUDGE_SYSTEM_PROMPT, systemPromptSha256, OPENCODE_MODELS, opencodeModel, checkOpencodeJudges };
