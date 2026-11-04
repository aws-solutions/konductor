// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KIRO_PREFIX = /^(KIRO_|[A-Z]+_KIRO_)/;
const SECRETISH = /(TOKEN|SECRET|CLIENT_ID|SESSION|KEY|PASSWORD)/;

// The agent and check commands get these inherited variables and nothing else.
const ALLOW = [
  'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'USER', 'LOGNAME',
  'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
];
// Kiro variables passed through to the agent (not to checks). Extend with --env-keep.
const KIRO_KEEP = [];
// Reported in run-config when present in the invoking shell. A mandatory MCP list can
// name a credential-vending server that trust-all-tools runs would reach, so it is never passed.
const NEVER_PASS = [/^[A-Z]+_KIRO_MANDATORY_MCPS$/, /^KIRO_SESSION_ID$/];

function redact(name, value) {
  return SECRETISH.test(name) ? '<redacted>' : value;
}

function snapshotKiroEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (KIRO_PREFIX.test(k)) out[k] = redact(k, v);
  return out;
}

function pick(baseEnv, names) {
  const env = {};
  for (const k of names) if (baseEnv[k] !== undefined) env[k] = baseEnv[k];
  return env;
}

function build(baseEnv, { home, tmpdir, agentEngine, keep = [], konductor = true }, withKiro) {
  const env = pick(baseEnv, [...ALLOW, ...(withKiro ? [...KIRO_KEEP, ...keep] : [])]);
  const set = {
    HOME: home,
    TMPDIR: tmpdir || path.join(home, 'tmp'),
    TERM: 'dumb',
  };
  // Only set where it can have an effect, so a vanilla agent does not see the name.
  if (konductor) set.KONDUCTOR_TELEMETRY = 'off';
  if (withKiro) {
    Object.assign(set, {
      KIRO_AGENT_ENGINE: agentEngine,
      KIRO_FEED_FILE: path.join(home, '.local/share/kiro-cli/feed.json'),
      KIRO_TURN_MARKER_DIR: path.join(home, '.local/share/kiro-cli/run/turn-markers'),
    });
  }
  Object.assign(env, set);
  const unset = Object.keys(baseEnv).filter((k) => NEVER_PASS.some((re) => re.test(k))).sort();
  return { env, set, unset, keys: Object.keys(env).sort() };
}

// Environment for the kiro-cli agent process.
function buildChildEnv(baseEnv, opts) {
  return build(baseEnv, opts, true);
}

// Environment for check commands: the same allowlist without any Kiro variable.
function buildCheckEnv(baseEnv, opts) {
  return build(baseEnv, opts, false);
}

// What env.json records: names of everything the agent sees, values only for pins.
function describeEnv(baseEnv, childSetup) {
  return {
    inherited: snapshotKiroEnv(baseEnv),
    finalKeys: childSetup.keys,
    set: Object.fromEntries(Object.entries(childSetup.set).map(([k, v]) => [k, redact(k, v)])),
    notPassed: childSetup.unset,
  };
}

// The arm build (cargo on an arbitrary ref, so its build.rs runs with the user's privileges) gets this and nothing else. No cloud,
// forge, registry or agent credentials, no SSH agent. HOME is a scratch directory; CARGO_HOME and RUSTUP_HOME point at the real
// ones so an offline build finds its crates and toolchain. Proxy variables go to an online build only.
const BUILD_ALLOW = [
  'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'USER', 'LOGNAME', 'TERM', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'RUSTUP_TOOLCHAIN',
  'CC', 'CXX', 'AR', 'CFLAGS', 'CXXFLAGS', 'CPPFLAGS', 'LDFLAGS', 'LD_LIBRARY_PATH', 'LIBRARY_PATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH',
  'PKG_CONFIG_PATH', 'PKG_CONFIG_SYSROOT_DIR', 'RUSTFLAGS', 'RUSTC_WRAPPER', 'CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL', 'RUST_BACKTRACE',
];
const BUILD_PROXY = ['http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY'];
const CREDENTIAL_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH|SESSION)/i;

const maskUrlCredentials = (v) => String(v).replace(/(:\/\/[^/:@\s]*:)[^@\s]+@/, '$1<redacted>@');

/**
 * { env, set, refused } for a cargo build. BENCH_BUILD_ENV_KEEP (comma separated names) adds variables a host's toolchain needs; a
 * name that looks like a credential is refused and listed in `refused`. `set` is what to record: values with URL credentials masked.
 */
function buildBuildEnv(baseEnv, { home, cargoTarget, online = false }) {
  const env = pick(baseEnv, [...BUILD_ALLOW, ...(online ? BUILD_PROXY : [])]);
  const keep = (baseEnv.BENCH_BUILD_ENV_KEEP || '').split(',').map((n) => n.trim()).filter(Boolean);
  const refused = keep.filter((n) => CREDENTIAL_NAME.test(n));
  Object.assign(env, pick(baseEnv, keep.filter((n) => !CREDENTIAL_NAME.test(n))));
  const realHome = baseEnv.HOME;
  const cargoHome = baseEnv.CARGO_HOME || (realHome ? path.join(realHome, '.cargo') : null);
  const rustupHome = baseEnv.RUSTUP_HOME || (realHome ? path.join(realHome, '.rustup') : null);
  if (cargoHome && fs.existsSync(cargoHome)) env.CARGO_HOME = cargoHome;
  if (rustupHome && fs.existsSync(rustupHome)) env.RUSTUP_HOME = rustupHome;
  env.HOME = home;
  env.TMPDIR = path.join(home, 'tmp');
  env.CARGO_TARGET_DIR = cargoTarget;
  return { env, set: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, maskUrlCredentials(v)])), refused };
}

module.exports = { buildChildEnv, buildCheckEnv, buildBuildEnv, describeEnv, snapshotKiroEnv, ALLOW, KIRO_KEEP, NEVER_PASS, BUILD_ALLOW };
