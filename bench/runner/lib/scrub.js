// SPDX-License-Identifier: Apache-2.0
'use strict';

// Removes credentials from run output. Exact values come from credential-named environment variables (and from the
// caller); everything else is caught by shape. A secret key setting keeps its name and loses its value.

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTHORIZATION)/i;
const MIN_LITERAL = 8;
const MASK = '<redacted>';

// [pattern, replacement]. Order matters only where one match could contain another.
const SHAPES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK],
  [/(aws_secret_access_key|aws_session_token)(["']?\s*[=:]\s*["']?)[^\s"',;}]+/gi, `$1$2${MASK}`],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, `$1${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, MASK],
  [/\b(?:aoa|aor)[A-Za-z0-9_-]{40,}\b/g, MASK],
];

/** Values of credential-named variables in `env`, at least 8 characters long, longest first so one never hides inside another. */
function secretLiterals(env = process.env, extra = []) {
  const found = new Set(extra.filter((v) => typeof v === 'string' && v.length >= MIN_LITERAL));
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length >= MIN_LITERAL && SECRET_NAME.test(name)) found.add(value);
  }
  return [...found].sort((a, b) => b.length - a.length);
}

function scrubString(text, literals = []) {
  let out = text;
  for (const l of literals) if (l && out.includes(l)) out = out.split(l).join(MASK);
  for (const [re, to] of SHAPES) out = out.replace(re, to);
  return out;
}

/** scrubString that also counts the replacements made: one per literal occurrence and one per shape match. */
function scrubStringCounted(text, literals = []) {
  let out = text;
  let count = 0;
  for (const l of literals) {
    if (!l || !out.includes(l)) continue;
    const parts = out.split(l);
    count += parts.length - 1;
    out = parts.join(MASK);
  }
  for (const [re, to] of SHAPES) {
    const found = out.match(re);
    if (!found) continue;
    count += found.length;
    out = out.replace(re, to);
  }
  return { text: out, count };
}

/** A copy of `value` with every string scrubbed. count is the number of strings that changed. */
function scrubDeep(value, literals = []) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      const s = scrubString(v, literals);
      if (s !== v) count++;
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), count };
}

module.exports = { secretLiterals, scrubString, scrubStringCounted, scrubDeep, SHAPES, MASK };
