// SPDX-License-Identifier: Apache-2.0
'use strict';

// The multiset key for matching stream calls to gateway calls: (tool, canonical args). Never reads rpc_id.

const crypto = require('node:crypto');

const PURPOSE_FIELD = '__tool_use_purpose';

/** JSON of `value` with object keys sorted at every level and no spaces; numbers print as JSON.stringify does. */
function canonicalArgs(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalArgs).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalArgs(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 hex of `canonicalArgs(args)`, the same value the gateway logs as `args_sha256`. */
function argsSha256(args) {
  return crypto.createHash('sha256').update(canonicalArgs(args), 'utf8').digest('hex');
}

/** The arguments the agent sent, from a stream `rawInput`: engine v2 adds a purpose field the server never sees. */
function streamArgs(rawInput) {
  const { [PURPOSE_FIELD]: _purpose, ...args } = rawInput || {};
  return args;
}

module.exports = { canonicalArgs, argsSha256, streamArgs };
