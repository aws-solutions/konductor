// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes the versioned keys of the STANDARD key audit of 2026-11-24 (the LITE audit method applied to the 68 STANDARD,
// gated and T13 tasks; report: reports/standard-key-audit-2026-11-24.md in the mate workspace). Base keys stay as they are.
//   Findings keys (T2 reviews, the T5 suite audit): the request sets no cap on findings, yet the key scaled any list past
//   3 (T5: 1.5) times the key size; the saved pilot reviews listed 26 and 39 against caps of 18 and 24. The new keys set
//   `lengthAllowance: null` (no length term; precision is still reported). Each seeded item's fix keywords, which gate the
//   item (fixRequired), become an alternative set: every base keyword kept, plus the plain wordings a correct finding uses
//   for the same fix (from the saved pilot runs where they exist, reasoned synonyms otherwise). Locations, severities and
//   decoys are unchanged.
//   Block keys (T8, T10, T12): a list cap the request never states is raised to what a careful answer needs, and a regex
//   that wants a word neither the request nor the folder supplies takes the wordings the saved runs used.
//   node bench/scenarios/rewrite-standard-keys.js            write the keys
//   node bench/scenarios/rewrite-standard-keys.js --check    exit 1 when a written key differs from what this would write

const fs = require('node:fs');
const path = require('node:path');

const S = __dirname;
const NOTE = 'STANDARD key audit 2026-11-24 (rewrite-standard-keys.js)';

// T2 reviews: hidden/<id>/hidden/key.json -> hidden/<id>-v<N>/hidden/key.json. `add` lists the alternatives per item.
const T2 = {
  't2-dr-data-erasure': { to: 4, add: {
    k1: ['restore', 'replay', 'snapshot', 'expire', 'expiry', 'shred', 'encryption key', '90-day', '90 day', 'backups'],
    k2: ['analytics', 'warehouse rows', 'verify deletion', 'deletion event'],
    k3: ['reconcil', 'end-to-end', 'every system', 'all systems', 'confirm each', 'verified complete', 'proof of completion', 'completion report', 'status per system'],
    k4: ['minimum evidence', 'request reference', 'pseudonym', 'drop the email', 'drop email', 'strip', 'redact', 'no personal data'],
    k5: ['vendor', 'provider', 'removal contract', 'removal api', 'delete endpoint', 'erasure request'],
    k6: ['calendar-day', 'legal deadline', 'business days', 'do not pause', 'no pause'],
  } },
  't2-dr-orders-dynamo-model': { to: 2, add: {
    k1: ['hot partition', 'write sharding', 'suffix', 'high-cardinality', 'high cardinality', 'spread writes', 'orderId as partition'],
    k2: ['index on customer', 'customerId as partition', 'query by customer', 'avoid scan', 'no scan', 'instead of scan', 'global secondary index'],
    k3: ['INCLUDE', 'project only', 'projected attributes', 'smaller projection', 'only the fields'],
    k4: ['400 KB', '400kb', 'item limit', 'separate items', 'one item per line', 'line item items', 'object store', 'chunk'],
    k5: ['atomic add', 'atomic counter', 'condition expression', 'dedup', 'event id', 'transact'],
    k6: ['export to s3', 'dynamodb streams', 'stream', 'change data capture', 'aggregate on write', 'incremental export'],
  } },
  't2-dr-rate-limits': { to: 4, add: {
    k1: ['fail-open', 'fail open', 'fallback', 'degrade', 'local limit', 'local counter'],
    k2: ['sliding window', 'sliding log', 'boundary', 'double the limit', 'gcra'],
    k3: ['round trip', 'round-trip', 'one call', 'one command', 'incr', 'latency budget'],
    k4: ['clock skew', 'skew', 'redis time', 'server time', 'time from redis', 'single clock'],
    k5: ['per-customer', 'per customer', 'override', 'enterprise tier', 'peak-hour', 'burst allowance'],
    k6: ['retry-after', 'ratelimit-remaining', 'x-ratelimit-limit', 'response header'],
    k7: ['primary', 'read from primary', 'failover', 'stale count', 'stale read'],
    k8: ['alert', 'metric', 'dashboard', 'breaker state', 'degraded state'],
  } },
  't2-pr-avatar-upload': { to: 7, add: {
    k1: ['basename', 'secure_filename', 'generated name', 'uuid', 'random name', 'realpath', 'inside upload'],
    k2: ['size limit', '2 mb', 'pass max_size', 'enforce limit'],
    k3: ['pillow', 're-encode', 'reencode', 'content-type', 'mime', 'whole file', 'open the image'],
    k4: ['unlink', 'remove the temp', 'remove temp', 'try/finally', 'clean up'],
    k5: ['opaque id', 'random id', 'uuid', 'do not use email', 'not the email', 'without email', 'pii'],
    k6: ['remove old', 'previous file', 'previous avatar', 'old avatar', 'unlink'],
    k7: ['docs', 'doc says', 'fix the doc', 'correct the doc', 'api.md'],
  } },
  't2-pr-ledger-transfer': { to: 2, add: {
    k1: ['single transaction', 'all-or-nothing', 'all or nothing', 'one write', 'commit both', 'rollback'],
    k2: ['check the key first', 'check first', 'before posting', 'before the journal', 'unique constraint', 'idempotency key', 'dedup'],
    k3: ['parseFloat', 'Math.round', 'rounding', 'integer minor', 'minor units', 'string parse', 'bigint', 'cents'],
    k4: ['every account', 'include today', 'include new', 'remove the date filter', 'createdAt filter', 'no filter'],
    k5: ['mark failed', 'failed status', 'rethrow', 'propagate', 'do not mark done', 'not done'],
    k6: ['getUTCHours', 'getUTC', 'utc time', 'daylight'],
  } },
  't2-pr-order-contract': { to: 2, add: {
    k1: ['keep displayTotal', 'both fields', 'deprecat', 'old field', 'keep the old'],
    k2: ['not required', 'make it optional', 'default empty', 'allow missing', 'nullable'],
    k3: ['keep paused', 'add paused', 'stored status', 'map paused', 'tolerate'],
    k4: ['number', 'keep it numeric', 'do not stringify', 'not a string'],
    k5: ['iso 4217', '3-letter', 'three-letter', 'regex', 'allowlist', 'length 3'],
    k6: ['single transaction', 'same transaction', 'all-or-nothing', 'all or nothing'],
    k7: ['authenticat', 'require admin', 'restrict', 'remove the route', 'internal only', 'pii'],
  } },
  't2-pr-orders-migration': { to: 4, add: {
    k1: ['expand', 'contract', 'two-step', 'two step', 'add nullable', 'backfill', 'rolling deploy', 'old code'],
    k2: ['batches', 'chunks', 'backfill', 'smaller transactions', 'locking'],
    k3: ['data loss', 'irreversible', 'export', 'copy the column', 'confirm'],
    k4: ['parameterized', 'parameterised', 'bind', 'sql injection', 'escape'],
    k5: ['in clause', 'one query', 'eager', 'prefetch', 'n + 1'],
    k6: ['add an index', 'add index', 'covering index', 'multi-column', 'multicolumn'],
    k7: ['concurrently', 'non-blocking', 'nonblocking', 'lock-free', 'without locking', 'online index'],
  } },
  't2-sec-dr-partner-webhooks': { to: 2, add: {
    k1: ['ssrf', 'private ip', 'private range', 'rfc 1918', 'rfc1918', 'metadata', '169.254', 'deny list', 'block internal', 'resolve and check', 'pin the ip', 'egress proxy'],
    k2: ['freshness', 'signed timestamp', 'replay', 'tolerance', 'expiry', 'event id'],
    k3: ['per partner', 'per-tenant secret', 'separate secret', 'one secret per', 'unique secret', 'secret per partner'],
    k4: ['data minimi', 'minimum fields', 'standard profile', 'drop contact', 'exclude pii', 'pii', 'personal data'],
    k5: ['two keys', 'both keys', 'old and new', 'overlap', 'key id', 'rotation'],
    k6: ['per-partner queue', 'per partner queue', 'isolation', 'noisy neighbour', 'noisy neighbor', 'bulkhead', 'fairness', 'concurrency limit'],
    k7: ['retention', '30 days', 'digest', 'redact', 'shorter retention', 'delete payload'],
  } },
  't2-dr-doc-ready-for-review': { to: 2, add: {
    k1: ['60-second', 'measurable', 'target', 'metric', 'objective'],
    k2: ['remove', 'out-of-scope', 'scope', 'defer', 'later release'],
    k3: ['workload', 'baseline', 'growth', 'numbers', 'horizon'],
    k4: ['alternative', 'real alternative', 'second option', 'trade-off', 'tradeoff'],
    k5: ['duplicate', 'repeat', 'refer to 4.2', 'link to 4.2', 'merge'],
    k6: ['remove', 'trim', 'shorten', 'actionable'],
  } },
  't2-dr-plan-start-monday': { to: 2, add: {
    k1: ['acceptance', 'criteria', 'contract', 'measur', 'ndcg', 'golden set', 'baseline'],
    k2: ['producing step', 'where it comes from', 'build the bundle', 'add a step', 'missing step', 'prerequisite'],
    k3: ['catalog-search-2025-03', 'reserved name', 'hyphenated', 'naming'],
    k4: ['same name', 'consistent', 'match 3.3', 'one name'],
    k5: ['another owner', 'backup owner', 'different owner', 'move the date', 'reschedule', 'not available'],
    k6: ['roll back', 'revert', 'switch back', 'alias back', 'trigger', 'abort criteria'],
    k7: ['done criteria', 'definition of done', 'exit criteria', 'checks', 'acceptance'],
  } },
  't2-dr-search-options': { to: 2, add: {
    k1: ['weights', 'weighting', 'relevance first', 'match 2.3', 'reorder', 'rescore'],
    k2: ['engineering time', 'staffing', 'people cost', 'labour', 'labor', 'ops time', 'headcount'],
    k3: ['benchmark at scale', 'own data', 'realistic', 'scale test', 'load test', '108 million'],
    k4: ['stemming', 'every locale', 'all languages', 'each language', 'locale', 'analyzer'],
    k5: ['migration plan', 'cutover', 'validate', 'dual write', 'dual-write'],
    k6: ['prefix', 'real query', 'production query', 'same query', 'representative query'],
  } },
  't2-gaps-rev3-history': { to: 2, add: {
    k1: ['conditional update', 'row lock', 'locking', 'race condition', 'concurrent', 'single statement', 'where balance'],
    k2: ['business date', 'business_date', 'utc date', 'configured timezone', 'local date'],
    k3: ['two decimal', '2 decimal', 'no floor', 'do not floor', 'remove floor', 'Math.round'],
    k4: ['admin', 'authorization', 'authorisation', 'auth check', 'require role', 'requireAdmin', 'permission'],
    k5: ['idempotency key', 'idempotent', 'dedup', 'do not retry', 'no retry'],
    k6: ['10,000', 'max amount', 'upper bound', 'upper limit', 'validate the amount'],
  } },
  't2-pr-catalog-api-v2': { to: 2, add: {
    k1: ['displayName', 'keep both', 'deprecat', 'alias', 'old field'],
    k2: ['optional', 'not required', 'remove from required', 'drop from required'],
    k3: ['archived', 'keep archived', 'allow archived', 'stored rows', 'existing rows'],
    k4: ['number', 'numeric', 'integer', 'not a string', 'do not format'],
    k5: ['maxItems', 'max 12', 'twelve', '12 items', 'limit the array'],
    k6: ['additionalProperties', 'reject unknown keys', 'unknown keys', 'strict schema'],
    k7: ['document', 'docs', 'openapi', 'catalog.yaml', 'mark required'],
  } },
  't2-pr-precheck-uncommitted': { to: 2, add: {
    k1: ['less than or equal', 'boundary', 'off-by-one', 'off by one', 'inclusive bound'],
    k2: ['throw', 'propagate', 'return an error', 'fail the quote', '503 error', 'do not return zero', 'not zero'],
    k3: ['mask', 'remove the account', 'strip', 'do not log', 'log only', 'allowlist fields'],
    k4: ['sandbox', 'do not overwrite', 'keep the production', 'fallback only', 'default only when'],
    k5: ['country', 'country code', 'include country', 'key on country'],
    k6: ['assert the quote', 'check the returned', 'assert the total', 'returned total', 'service result'],
  } },
};

// The T5 suite audit: findings-kit/key.json -> <id>-v<N>/findings-kit/key.json, fixMin kept.
const T5 = {
  't5-qa-suite-audit': { to: 5, add: {
    'proration-self-comparison': ['hard-coded', 'hardcoded', 'known value', 'worked example', 'literal', 'fixed number', 'oracle', 'tautolog', 'compares with itself', 'same function'],
    'invoice-output-recomputed': ['hard-coded', 'hardcoded', 'golden', 'known value', 'tautolog', 'same code', 'recompute', 'schema'],
    'retry-unit-replaced': ['mock', 'mocked', 'fake', 'replaced', 'real retry', 'unit under test', 'actual code'],
    'webhook-error-ignored': ['rejects', 'assert.rejects', 'assert.throws', 'expect an error', 'status code', 'swallow', 'catch'],
    'proration-shared-formula': ['hard-coded', 'hardcoded', 'known value', 'worked example', 'same formula', 'copied formula', 'tautolog', 'literal'],
    'api-body-unchecked': ['status only', 'json body', 'fields', 'deepEqual', 'deepStrictEqual', 'check the body', 'response body'],
    'empty-adjustment-loop': ['empty', 'never runs', 'no cases', 'zero iterations', 'vacuous', 'length', 'at least one'],
    'snapshot-overwritten': ['update flag', '--update', 'regenerat', 'overwrit', 'stored snapshot', 'golden file', 'checked in'],
  } },
};

// Block keys: item patches. `max` replaces a list cap; `regex` replaces one regex of an item's `all` list (by index);
// `field` drops or sets the item's match field.
const BLOCK = {
  't8-nfr-slo-burn': { to: 4, kit: 'block-kit', why: 'the alert-list cap of 4 is not in the request; the multi-window burn-rate pattern pages and tickets at up to four windows per objective, so two objectives need up to 8 (both saved pilot runs listed 7 and 8)',
    items: { 'alert-list-is-focused': { max: 8 } } },
  't8-inc-memory-leak': { to: 5, kit: 'block-kit', why: 'the action-item cap of 10 is not in the request (a saved run listed 11 owned actions); 15 matches the timeline cap',
    items: { 'actions-bounded': { max: 15 } } },
  't12-sdlc-contact-import': { to: 6, kit: 'block-kit', why: 'the decisions cap of 10 is not in the request (the saved run listed 13 decisions, each with its reason); 15 still bounds a dump',
    items: { 'decisions-bounded': { max: 15 } } },
  't8-runbook-db-failover': { to: 5, kit: 'block-kit', why: 'the folder never says monitor, watch or observe; the saved runs wrote the post-change window as "Wait 60 seconds" or "client errors continue 30 seconds after the check", in action or verify, so the item reads the whole step and takes wait, re-check and check-again wordings',
    items: { 'monitoring-window-is-present': { field: null, regex: { 0: 'monitor|watch|observe|wait|re-?check|re-?run|check again|keep checking|dashboard|console' } } } },
  't10-arch-outbox': { to: 4, kit: 'rollout-kit', why: 'rollback-preserves wanted reconcile, retain or without deleting; the saved run wrote "Keep the data files and the statusEvents collection; do not edit or delete them", so keep, preserve and do-not-delete wordings count',
    items: { 'rollback-preserves': { regex: { 2: "reconcile|retain|without deleting|keep|preserve|do not (edit or )?delete|don't delete|not delete|leave .{0,40}(in place|intact)" } } } },
};

const read = (rel) => JSON.parse(fs.readFileSync(path.join(S, rel), 'utf8'));
const merge = (base, add) => [...base, ...add.filter((w) => !base.some((b) => b.toLowerCase() === w.toLowerCase()))];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

/**
 * The rest of each versioned hidden dir: every file of the base hidden dir except the rewritten key, byte for byte
 * (shared-lib manifests, behaviour tests, a second kit), so the new dir is a whole kit. { relPath: text }.
 */
function copies(keys) {
  const out = {};
  for (const rel of Object.keys(keys)) {
    const [batch, , vdir, ...rest] = rel.split('/');
    const id = vdir.replace(/-v\d+$/, '');
    const task = read(`${batch}/${id}.json`);
    const baseDir = path.join(S, batch, 'hidden', task.hidden || id);
    for (const f of walk(baseDir)) {
      const sub = path.relative(baseDir, f).split(path.sep).join('/');
      const to = `${batch}/hidden/${vdir}/${sub}`;
      if (sub === rest.join('/') || keys[to]) continue;
      out[to] = fs.readFileSync(f, 'utf8');
    }
  }
  return out;
}

function build() {
  const out = {};
  for (const [id, cfg] of Object.entries(T2)) {
    const src = read(`t2/hidden/${id}/hidden/key.json`);
    const key = { [`_v${cfg.to}`]: `${NOTE}: no length term (the request sets no cap on findings) and each item's fix keywords widened to an alternative set; base keywords, sections, lines, severities and decoys kept.`, lengthAllowance: null };
    for (const [k, v] of Object.entries(src)) if (!k.startsWith('_') && k !== 'lengthAllowance') key[k] = v;
    key.items = key.items.map((it) => (cfg.add[it.id] ? { ...it, fix: merge(it.fix, cfg.add[it.id]) } : it));
    out[`t2/hidden/${id}-v${cfg.to}/hidden/key.json`] = key;
  }
  for (const [id, cfg] of Object.entries(T5)) {
    const src = read(`t5/hidden/${id}/findings-kit/key.json`);
    const key = { _note: `${NOTE}: no length term (the request sets no cap on findings) and each risk's fix words widened to an alternative set; base words, locations, severities and fixMin kept.`, lengthAllowance: null };
    for (const [k, v] of Object.entries(src)) if (!k.startsWith('_') && k !== 'lengthAllowance') key[k] = v;
    key.findingsKey = key.findingsKey.map((it) => (cfg.add[it.id] ? { ...it, fix: merge(it.fix, cfg.add[it.id]) } : it));
    out[`t5/hidden/${id}-v${cfg.to}/findings-kit/key.json`] = key;
  }
  for (const [id, cfg] of Object.entries(BLOCK)) {
    const batch = id.split('-')[0];
    const task = read(`${batch}/${id}.json`);
    const src = read(`${batch}/hidden/${task.hidden || id}/${cfg.kit}/key.json`);
    const key = { _note: `${NOTE}: ${cfg.why}.`, ...Object.fromEntries(Object.entries(src).filter(([k]) => !k.startsWith('_'))) };
    key.items = key.items.map((it) => {
      const p = cfg.items[it.id];
      if (!p) return it;
      const next = JSON.parse(JSON.stringify(it));
      if (p.max !== undefined) next.max = p.max;
      if (p.field === null) delete next.match.field;
      for (const [i, r] of Object.entries(p.regex || {})) next.match ? (next.match.all[i] = r) : (next.all[i] = r);
      return next;
    });
    out[`${batch}/hidden/${id}-v${cfg.to}/${cfg.kit}/key.json`] = key;
  }
  return out;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let bad = 0;
  const keys = build();
  const files = { ...Object.fromEntries(Object.entries(keys).map(([rel, key]) => [rel, `${JSON.stringify(key, null, 2)}\n`])), ...copies(keys) };
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(S, rel);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(`${rel}: differs from rewrite-standard-keys.js`); bad++; }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`wrote ${rel}`);
    }
  }
  if (check) { console.log(bad ? `${bad} key(s) differ` : 'ok: the STANDARD audit keys match rewrite-standard-keys.js'); process.exit(bad ? 1 : 0); }
}

module.exports = { build, copies, T2, T5, BLOCK };
