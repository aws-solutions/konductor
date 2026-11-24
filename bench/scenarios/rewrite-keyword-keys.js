// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes the semantic keyword keys of the four LITE tasks whose code score was keyword-gated (the key validity audit of
// 2026-11-24): each seeded item's fix keywords become an alternative set that accepts the wordings a correct finding
// used in the saved runs of every arm (reports/task-key-fixes-2026-11-24-data/synonyms.txt), two items gain a second
// location where answers placed the same risk, and the T2 keys set no length term (the request sets no cap). Locations,
// severities and the structural checks are unchanged. The base keys stay; this writes into the -vN hidden dirs.
//   node bench/scenarios/rewrite-keyword-keys.js            write the four keys
//   node bench/scenarios/rewrite-keyword-keys.js --check    exit 1 when a written key differs from what this would write
// The alternative sets are data, kept here so a reviewer sees every added phrase next to the one it stands for.

const fs = require('node:fs');
const path = require('node:path');

const S = __dirname;

// T5 test plans: a risk is "named with a fitting test" when the planned test's text holds one of these words.
const T5 = {
  't5-qa-checkout-strategy': {
    from: 't5/hidden/t5-qa-checkout-strategy/findings-kit/key.json', to: 't5/hidden/t5-qa-checkout-strategy-v5/findings-kit/key.json',
    fix: {
      'money-floating-point': ['cents', 'integer', 'decimal', 'minor unit', 'floating', 'half cent', 'rounding', 'x 100', '1.005', '3224', 'exact amount'],
      'webhook-replay': ['idempotency', 'event id', 'replay', 'duplicate', 'twice', 'same event', 'delivered again', 'second delivery', 'redeliver', 'out of order', 'stale'],
      'inventory-read-write-race': ['atomic', 'concurrency', 'concurrent', 'concurrently', 'parallel', 'simultaneous', 'overlapping', 'exactly one', 'one succeeds', 'never below zero', 'never goes negative', 'oversell', 'compare-and-decrement', 'race condition', 'locking'],
      'retry-double-charge': ['idempotency', 'status lookup', 'ambiguous timeout', 'double-charge', 'double charge', 'no retry', 'not retried', 'one charge', 'charges once', 'charged once', 'same order id', 'one effective charge', 'timeout', 'decline'],
      'email-swallowed-error': ['log', 'alert', 'surface', 'propagate', 'dead-letter', 'retry', 'swallow', 'swallowed', 'fail silently', 'silently', 'error is reported', 'surfaced'],
      'settlement-local-cutoff': ['utc', 'timezone', 'time zone', 'cutoff', 'midnight', 'local time', 'tz', 'day boundary'],
      'refund-rounding': ['remainder', 'allocat', 'cents', 'rounding', 'sum of', 'amount', '2500', 'exact', 'math.round', 'x 100', 'integer', 'equals the charge'],
      'guard-disabled-by-default': ['flag', 'default', 'disabled', 'out-of-stock', 'out of stock', 'oversell', 'guard', 'requireInventoryGuard', 'stock is restored', 'restores stock', 'releases', 'released', 'decrement'],
    },
    location: { 'retry-double-charge': ['src/payments/retry.js', 'src/orders/checkout.js'] },
  },
  't5-qa-sync-strategy': {
    from: 't5/hidden/t5-qa-sync-strategy/findings-kit/key.json', to: 't5/hidden/t5-qa-sync-strategy-v4/findings-kit/key.json',
    fix: {
      'checkpoint-before-commit': ['checkpoint', 'commit', 'crash', 'atomic', 'resume', 'killed', 'kill at', 'interrupted', 'partial page', 'dead-letter', 'dead letter', 'bad row', 'reject count'],
      'mapper-silent-coercion': ['precision', 'truncat', 'coerc', 'lossy', 'round-trip', 'overflow', 'silent', 'silently', 'non-numeric', 'reject', 'credit_limit', 'credit limit', 'undefined', 'blank', 'padded', 'over-length', 'too long', 'emoji', 'encoding', 'every source column', 'mapped or'],
      'tie-order-dependence': ['tie', 'deterministic', 'order', 'stable', 'equal timestamps', 'equal timestamp', 'equal instants', 'same timestamp', 'identical timestamps', 'equal', 'version precedence', 'tie-break', 'ties'],
      'retry-reapplies-change': ['idempot', 'dedup', 'exactly once', 'change id', 'duplicate', 'twice', 'applied once', 'one effect', 'same change', 'retry', 'retryable', 'backoff', 'maxAttempts', 'attempt', 'attempts'],
      'count-only-verification': ['content', 'field-level', 'checksum', 'hash', 'per-record', 'row-level', 'field', 'fields', 'differ', 'differs', 'mismatch', 'ids differ', 'different ids', 'values', 'compare', 'equal counts', 'same count', 'counts match', 'missing row', 'extra row'],
      'timezone-naive-ordering': ['timezone', 'time zone', 'utc', 'offset', 'zone', 'zone-less', 'offsets', 'tz', 'mixed zones'],
      'dead-letter-loses-reason': ['reason', 'error message', 'preserve', 'diagnostic', 'error', 'error cause', 'error code', 'stored', 'persist', 'persisted', 'error text', 'keeps the error'],
      'resume-path-unexercised': ['resume', 'restart', 'cursor', 'end-to-end', 'integration', 'rerun', 're-run', 'checkpoint', 'pick up'],
    },
    location: { 'timezone-naive-ordering': ['src/conflicts/timestamps.js', 'compareTimestamps', 'src/conflicts/resolve-conflict.js'] },
  },
};

// T2 design reviews: a finding at the item's section counts when its fix or issue holds one of these words.
const T2 = {
  't2-dr-notify-fanout': {
    from: 't2/hidden/t2-dr-notify-fanout-v5/hidden/key.json', to: 't2/hidden/t2-dr-notify-fanout-v6/hidden/key.json',
    note: 'v6: the v5 key (no length term, v4 keywords) with each item\'s fix keywords widened to the wordings a correct finding used in the saved LITE runs (ledger, claim, collapse key, dedupe; DLQ, cap attempts; quota).',
    fix: {
      k1: ['deduplication', 'idempotency', 'duplicate detection', 'dedup', 'dedupe', 'ledger', 'claim', 'collapse', 'once per', 'mark it sent', 'mark sent', 'exactly once', 'send-time'],
      k2: ['retry limit', 'dead letter queue', 'max retries', 'circuit breaker', 'dlq', 'dead letter', 'dead-letter', 'cap attempts', 'cap total attempts', 'retry budget', 'bounded', 'attempt count', 'exhausted', 'attempts'],
      k3: null, k5: null, k6: null, k7: null,
      k4: ['throttl', 'rate limit', 'token bucket', 'sendgrid limit', 'quota', 'quotas', 'per-second limit', 'sendgrid'],
    },
  },
  't2-arch-dr-split-checkout': {
    from: 't2/hidden/t2-arch-dr-split-checkout/hidden/key.json', to: 't2/hidden/t2-arch-dr-split-checkout-v4/hidden/key.json',
    note: 'v4: no length term (the request sets no cap on findings; v3 scaled any list past 21 by 21 / reported) and each item\'s fix keywords widened to the wordings a correct finding used in the saved LITE runs of every arm (owning team, single writer, void, release, compensation, observed p99, shadow or sticky routing, Customer Foundations, per caller).',
    lengthAllowance: null,
    fix: {
      k1: ['service-owned schema', 'stop direct writes', 'separate database', 'owning team', 'owning teams', 'owners', 'owner', 'single writer', 'own tables', 'ownership', 'through the api', 'through their api', 'write access', 'direct write', 'service-owned', 'written approval', 'written agreement'],
      k2: ['saga', 'compensating action', 'durable workflow', 'compensat', 'void authorization', 'void the authorization', 'void and release', 'void step', 'explicit void', 'idempotent void', 'void or cancel', 'release the reservation', 'release reservation', 'release partial', 'reserve before', 'reserve first', 'reserving before', 'failure path', 'failure table', 'partial failure', 'reconcil'],
      k3: ['latency budget', 'parallelize', 'remove hop', 'measured p99', 'observed', 'measure', 'measured', 'load test', 'load-test', 'prototype', 'parallel', 'concurrently', 'the sum', 'sum plus', 'sums', 'timeouts', 'budget', 'p99', '700 ms', '450 ms'],
      k4: ['shadow traffic', 'dual-run', 'compare responses', 'shadow', 'replay', 'dual run', 'compare', 'comparison', 'sticky', 'hash of the checkout token', 'hash', 'exit criteria', 'duplicate authoriz', 'both implementations', 'same requests'],
      k5: ['assign owner', 'customer table', 'ownership decision', 'customer foundations', 'owner', 'ownership', 'agree', 'agreement', 'boundary', 'access path', 'api only', 'field list'],
      k6: ['migration plan', 'caller inventory', 'adapter owner', 'caller', 'callers', 'per caller', 'each caller', 'retirement', 'contract', 'adapter', 'allow-list', 'allow list'],
      k7: ['provider idempotency key', 'deduplicate', 'durable retry record', 'idempotency key', 'idempotency', 'dedup', 'durable', 'record the request', 'before retrying'],
    },
  },
};

function build() {
  const out = {};
  for (const [id, cfg] of Object.entries(T5)) {
    const key = JSON.parse(fs.readFileSync(path.join(S, cfg.from), 'utf8'));
    key._note = `Semantic fix keywords (2026-11-24): each risk's "fitting test" words accept the wordings a correct plan used in the saved LITE runs of every arm; ${Object.keys(cfg.location).join(', ')} gain a second location where plans placed the risk. Locations, severities and the precision test are unchanged.`;
    for (const item of key.findingsKey) {
      if (cfg.fix[item.id]) item.fix = cfg.fix[item.id];
      if (cfg.location[item.id]) item.location = cfg.location[item.id];
    }
    out[cfg.to] = key;
  }
  for (const [, cfg] of Object.entries(T2)) {
    const src = JSON.parse(fs.readFileSync(path.join(S, cfg.from), 'utf8'));
    const key = {};
    key[`_${path.basename(path.dirname(path.dirname(cfg.to))).split('-').pop()}`] = cfg.note;
    key.lengthAllowance = 'lengthAllowance' in cfg ? cfg.lengthAllowance : src.lengthAllowance;
    for (const [k, v] of Object.entries(src)) if (!k.startsWith('_') && k !== 'lengthAllowance') key[k] = v;
    for (const item of key.items) if (cfg.fix[item.id]) item.fix = cfg.fix[item.id];
    out[cfg.to] = key;
  }
  return out;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const [rel, key] of Object.entries(build())) {
    const file = path.join(S, rel);
    const text = `${JSON.stringify(key, null, 2)}\n`;
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(`${rel}: differs from rewrite-keyword-keys.js`); bad++; }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`wrote ${rel}`);
    }
  }
  if (check) { console.log(bad ? `${bad} key(s) differ` : 'ok: the four semantic keys match rewrite-keyword-keys.js'); process.exit(bad ? 1 : 0); }
}

module.exports = { build, T5, T2 };
