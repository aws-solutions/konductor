// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, parseJsonReply } = require('./util.js');

const DEFAULT_BUDGET_USD = 3;

class BudgetExceeded extends Error {}

/**
 * Wraps a caller ({model, prompt}) => {text, usd, tokens, error?} with an on-disk cache keyed by the prompt hash and a
 * cumulative spend cap. Cached answers cost nothing and never reach the caller. Spend is the sum of the `usd` stored in the
 * cache directory, so the cap holds across runs.
 */
function makeCachedModel({ caller, cacheDir, budgetUsd = DEFAULT_BUDGET_USD }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const entries = () => fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
  const spentUsd = () => entries().reduce((sum, f) => {
    try { return sum + (JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')).usd ?? 0); } catch { return sum; }
  }, 0);
  const stats = { calls: 0, hits: 0, newUsd: 0 };

  async function ask(model, prompt) {
    const salt = caller?.cacheSalt ? caller.cacheSalt(model) : 'none';
    const file = path.join(cacheDir, `${sha256(`${model}\n${salt}\n${prompt}`)}.json`);
    if (fs.existsSync(file)) {
      stats.hits++;
      return JSON.parse(fs.readFileSync(file, 'utf8')).text;
    }
    const spent = spentUsd();
    if (spent >= budgetUsd) throw new BudgetExceeded(`budget cap USD ${budgetUsd} reached (spent ${spent.toFixed(4)})`);
    if (!caller) throw new Error('no model backend configured and the answer is not cached');
    const r = await caller({ model, prompt });
    if (r.error || !r.text) throw new Error(`model ${model}: ${r.error ?? 'empty reply'}`);
    stats.calls++;
    stats.newUsd += r.usd ?? 0;
    fs.writeFileSync(file, `${JSON.stringify({ model, text: r.text, usd: r.usd ?? 0, tokens: r.tokens ?? null }, null, 2)}\n`);
    return r.text;
  }

  // One retry with a stricter ask when the reply is not JSON or fails `check`; the changed prompt gets its own cache entry.
  async function askJson(model, prompt, check = () => {}) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      const p = i === 0 ? prompt : `${prompt}\n\nYour previous reply was rejected (${lastErr}). Reply with only the JSON, nothing else.`;
      try {
        const value = parseJsonReply(await ask(model, p));
        check(value);
        return value;
      } catch (e) {
        if (e instanceof BudgetExceeded) throw e;
        lastErr = e.message.slice(0, 120);
      }
    }
    throw new Error(`model ${model}: no valid JSON after 2 tries (${lastErr})`);
  }

  return { ask, askJson, spentUsd, stats };
}

module.exports = { makeCachedModel, BudgetExceeded, DEFAULT_BUDGET_USD };
