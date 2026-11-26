// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { createRegistry, pluginPathRoots } = require('../core/registry.js');
const { JUDGE_SYSTEM_PROMPT, systemPromptSha256 } = require('./system-prompt.js');

// Which program asks the judge model. `kiro` is the one built-in and the default. Every other backend is a registry
// part of kind `judge-backend` from bench/plugins (FW-14): a descriptor `{ id, costUnit, label, maxPromptBytes?, offers? }` (`offers`: what judge views may need, see view/index.js) and
// an entry module exporting `makeCaller({ timeoutMs, rawDir, log, flags })`, which returns an async ({model, prompt})
// caller, and optionally `cacheSalt(model)` and `checkJudges(judges)` (see backendHook). `opencode`, on Amazon Bedrock,
// is the part in bench/plugins/opencode (B-014).
// The opencode backend's id, for the code that names it (study scripts, the spend estimate, cached USD replies).
const OPENCODE_BACKEND = 'opencode';
const BUILTIN_BACKENDS = Object.freeze([
  Object.freeze({ id: 'kiro', costUnit: 'credits', label: 'kiro-cli, spend in credits' }),
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

/**
 * The caller of a plugin backend `part`, from its entry module's makeCaller(opts). `opts`: `{ timeoutMs, rawDir, log,
 * flags }`, `flags` being the judge command's own options. Built-ins are built by the CLI.
 */
function makeBackendCaller(part, opts) {
  const mod = require(part.entry);
  if (typeof mod.makeCaller !== 'function') throw new Error(`judge backend ${part.name}: its entry module exports no makeCaller`);
  return mod.makeCaller(opts);
}

/** The function `name` (`cacheSalt` or `checkJudges`) a plugin backend's entry module exports, else null. */
function backendHook(part, name) {
  if (part?.source !== 'plugin') return null;
  const fn = require(part.entry)[name];
  return typeof fn === 'function' ? fn : null;
}

/**
 * The cache salt of USD backend `backend` for a plan, which has no caller: the part's cacheSalt hook, else the
 * backend id and the model, the salt a pass uses when its caller has none.
 */
function planSalt(backend, registry = null) {
  return backendHook(registryOf(registry).part(backend), 'cacheSalt') ?? ((model) => `${backend}\n${model}`);
}

/** The ids of every judge backend this bench can use, built-ins first. */
const BACKENDS = Object.freeze(registryOf(null).ids());

module.exports = { BACKENDS, BUILTIN_BACKENDS, DEFAULT_BACKEND, OPENCODE_BACKEND, backendRegistry, backendHook, checkBackend, planSalt, makeBackendCaller, JUDGE_SYSTEM_PROMPT, systemPromptSha256 };
