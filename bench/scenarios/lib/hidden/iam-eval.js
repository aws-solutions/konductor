// SPDX-License-Identifier: Apache-2.0
'use strict';

// A small offline evaluator for AWS IAM policy documents, used by the hidden tests of the T4 tasks.
// It answers one question: does this set of policies allow this request? It follows the documented
// evaluation logic for a single account: an explicit Deny wins, then any Allow, else an implicit deny.
// Layers (identity, resource, boundary, scp) can be combined with `decide`.
//
// Supported: Effect, Action/NotAction, Resource/NotResource, Principal/NotPrincipal, Condition with the
// string, ARN, numeric, date, Bool, IpAddress, Null operators, the IfExists suffix, the ForAnyValue and
// ForAllValues prefixes, and policy variables such as ${aws:username} or ${aws:PrincipalTag/team}.
// An unknown condition operator throws, so a test fails loudly instead of guessing.
// shortcut: no NotPrincipal-with-Deny cross-account nuances and no session policies; add them when a task needs them.

const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function globToRegExp(pattern, { caseInsensitive = false } = {}) {
  let src = '';
  for (const ch of String(pattern)) {
    if (ch === '*') src += '.*';
    else if (ch === '?') src += '.';
    else src += ch.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${src}$`, caseInsensitive ? 'is' : 's');
}

const ctxLookup = (context, key) => {
  const want = String(key).toLowerCase();
  for (const k of Object.keys(context || {})) if (k.toLowerCase() === want) return context[k];
  return undefined;
};

// Replaces ${key} with the request value; ${*}, ${?} and ${$} are literal characters. A variable with no value
// makes the string match nothing (null), as IAM does for Resource and condition values.
function substitute(value, context) {
  let missing = false;
  const out = String(value).replace(/\$\{([^}]+)\}/g, (_, key) => {
    if (key === '*' || key === '?' || key === '$') return key;
    const v = ctxLookup(context, key);
    if (v === undefined || Array.isArray(v)) { missing = true; return ''; }
    return String(v);
  });
  return missing ? null : out;
}

function matchesAction(patterns, action) {
  return asList(patterns).some((p) => globToRegExp(p, { caseInsensitive: true }).test(action));
}

function matchesResource(patterns, resource, context) {
  return asList(patterns).some((p) => {
    const s = substitute(p, context);
    return s !== null && globToRegExp(s).test(resource);
  });
}

const accountOf = (arn) => {
  const m = String(arn).match(/^arn:aws[a-z-]*:(?:iam|sts)::(\d{12}):/);
  return m ? m[1] : null;
};

// One principal entry (from the policy) against the request principal { AWS | Service | Federated: string }.
function matchesPrincipal(spec, reqPrincipal) {
  if (spec === '*') return true;
  if (!reqPrincipal) return false;
  for (const type of Object.keys(spec || {})) {
    const reqVal = reqPrincipal[type];
    if (reqVal === undefined) continue;
    for (const p of asList(spec[type])) {
      if (p === '*') return true;
      if (type === 'AWS') {
        const acct = /^\d{12}$/.test(p) ? p : (String(p).match(/^arn:aws[a-z-]*:iam::(\d{12}):root$/) || [])[1];
        if (acct && accountOf(reqVal) === acct) return true;
      }
      if (String(p) === String(reqVal)) return true;
    }
  }
  return false;
}

// ---- conditions

function ipToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function inCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const a = ipToInt(ip);
  const b = ipToInt(base);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const date = (v) => (/^\d+$/.test(String(v)) ? Number(v) * 1000 : Date.parse(v));

// base operator -> [compare(requestValue, policyValue) for one pair, negated?]
const BASE = {
  StringEquals: [(r, p) => String(r) === p, false],
  StringNotEquals: [(r, p) => String(r) === p, true],
  StringEqualsIgnoreCase: [(r, p) => String(r).toLowerCase() === p.toLowerCase(), false],
  StringNotEqualsIgnoreCase: [(r, p) => String(r).toLowerCase() === p.toLowerCase(), true],
  StringLike: [(r, p) => globToRegExp(p).test(String(r)), false],
  StringNotLike: [(r, p) => globToRegExp(p).test(String(r)), true],
  ArnEquals: [(r, p) => String(r) === p, false],
  ArnNotEquals: [(r, p) => String(r) === p, true],
  ArnLike: [(r, p) => globToRegExp(p).test(String(r)), false],
  ArnNotLike: [(r, p) => globToRegExp(p).test(String(r)), true],
  NumericEquals: [(r, p) => num(r) === num(p), false],
  NumericNotEquals: [(r, p) => num(r) === num(p), true],
  NumericLessThan: [(r, p) => num(r) < num(p), false],
  NumericLessThanEquals: [(r, p) => num(r) <= num(p), false],
  NumericGreaterThan: [(r, p) => num(r) > num(p), false],
  NumericGreaterThanEquals: [(r, p) => num(r) >= num(p), false],
  DateEquals: [(r, p) => date(r) === date(p), false],
  DateNotEquals: [(r, p) => date(r) === date(p), true],
  DateLessThan: [(r, p) => date(r) < date(p), false],
  DateLessThanEquals: [(r, p) => date(r) <= date(p), false],
  DateGreaterThan: [(r, p) => date(r) > date(p), false],
  DateGreaterThanEquals: [(r, p) => date(r) >= date(p), false],
  Bool: [(r, p) => String(r).toLowerCase() === p.toLowerCase(), false],
  BinaryEquals: [(r, p) => String(r) === p, false],
  IpAddress: [(r, p) => inCidr(r, p), false],
  NotIpAddress: [(r, p) => inCidr(r, p), true],
};

function parseOperator(op) {
  let rest = op;
  let set = null;
  const m = rest.match(/^(ForAnyValue|ForAllValues):(.+)$/);
  if (m) { set = m[1]; rest = m[2]; }
  let ifExists = false;
  if (rest !== 'Null' && rest.endsWith('IfExists')) { ifExists = true; rest = rest.slice(0, -'IfExists'.length); }
  if (rest !== 'Null' && !BASE[rest]) throw new Error(`iam-eval: unsupported condition operator ${op}`);
  return { base: rest, set, ifExists };
}

function evalConditionKey(op, key, policyValues, context) {
  const { base, set, ifExists } = parseOperator(op);
  const raw = ctxLookup(context, key);
  const present = raw !== undefined && !(Array.isArray(raw) && raw.length === 0);
  const pvals = asList(policyValues).map((v) => substitute(v, context)).filter((v) => v !== null);
  if (base === 'Null') {
    const wantNull = asList(policyValues).some((v) => String(v).toLowerCase() === 'true');
    return wantNull ? !present : present;
  }
  const [cmp, negated] = BASE[base];
  const one = (r) => pvals.some((p) => cmp(r, String(p)));
  if (set === 'ForAllValues') {
    if (!present) return true;
    return asList(raw).every((r) => (negated ? !one(r) : one(r)));
  }
  if (set === 'ForAnyValue') {
    if (!present) return false;
    return asList(raw).some((r) => (negated ? !one(r) : one(r)));
  }
  if (!present) return ifExists || negated;
  const vals = asList(raw);
  return negated ? !vals.some(one) : vals.some(one);
}

function matchesCondition(condition, context) {
  for (const op of Object.keys(condition || {})) {
    for (const key of Object.keys(condition[op] || {})) {
      if (!evalConditionKey(op, key, condition[op][key], context)) return false;
    }
  }
  return true;
}

// ---- statements and documents

function statementsOf(doc) {
  const d = typeof doc === 'string' ? JSON.parse(doc) : doc;
  return asList(d && d.Statement);
}

function statementApplies(st, req) {
  const ctx = req.context || {};
  if (st.Action !== undefined && !matchesAction(st.Action, req.action)) return false;
  if (st.NotAction !== undefined && matchesAction(st.NotAction, req.action)) return false;
  if (st.Action === undefined && st.NotAction === undefined) return false;
  if (req.resource !== undefined) {
    if (st.Resource !== undefined && !matchesResource(st.Resource, req.resource, ctx)) return false;
    if (st.NotResource !== undefined && matchesResource(st.NotResource, req.resource, ctx)) return false;
  }
  if (st.Principal !== undefined && !matchesPrincipal(st.Principal, req.principal)) return false;
  if (st.NotPrincipal !== undefined && matchesPrincipal(st.NotPrincipal, req.principal)) return false;
  return matchesCondition(st.Condition, ctx);
}

/** 'deny' (explicit), 'allow' or 'implicit' for one request against a list of policy documents taken together. */
function evaluate(docs, req) {
  let allowed = false;
  for (const doc of asList(docs)) {
    for (const st of statementsOf(doc)) {
      if (!statementApplies(st, req)) continue;
      if (st.Effect === 'Deny') return 'deny';
      if (st.Effect === 'Allow') allowed = true;
    }
  }
  return allowed ? 'allow' : 'implicit';
}

const isAllowed = (docs, req) => evaluate(docs, req) === 'allow';

/**
 * Same-account decision over layers: { identity, resource, boundary, scp } (each a list of documents; an empty or
 * missing layer is skipped, except identity and resource, of which at least one must allow).
 */
function decide(layers, req) {
  const all = ['identity', 'resource', 'boundary', 'scp'].flatMap((k) => asList(layers[k]));
  if (evaluate(all, req) === 'deny') return false;
  for (const k of ['boundary', 'scp']) if (asList(layers[k]).length && evaluate(layers[k], req) !== 'allow') return false;
  return evaluate(asList(layers.identity), req) === 'allow' || evaluate(asList(layers.resource), req) === 'allow';
}

/** Structural problems a real IAM parser would refuse; an empty list means the document looks valid. */
function lint(doc) {
  const problems = [];
  let d = doc;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return [`not JSON: ${e.message}`]; } }
  if (!d || typeof d !== 'object') return ['not an object'];
  if (d.Version !== '2012-10-17') problems.push('Version must be "2012-10-17"');
  const sts = asList(d.Statement);
  if (!sts.length) problems.push('no Statement');
  sts.forEach((st, i) => {
    if (!['Allow', 'Deny'].includes(st.Effect)) problems.push(`statement ${i}: Effect must be Allow or Deny`);
    if ((st.Action === undefined) === (st.NotAction === undefined)) problems.push(`statement ${i}: exactly one of Action or NotAction`);
    if (st.Resource !== undefined && st.NotResource !== undefined) problems.push(`statement ${i}: both Resource and NotResource`);
    for (const op of Object.keys(st.Condition || {})) {
      try { parseOperator(op); } catch (e) { problems.push(`statement ${i}: ${e.message}`); }
    }
  });
  return problems;
}

module.exports = { evaluate, isAllowed, decide, lint, matchesCondition, globToRegExp, inCidr };
