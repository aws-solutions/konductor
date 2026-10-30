// SPDX-License-Identifier: Apache-2.0
'use strict';

// Detective control for runs without a mount namespace: list paths in the real HOME,
// the repository and extra watch dirs that changed after a marker file was touched.
// The walk is depth-limited because a full scan of a large home takes minutes.

const fs = require('node:fs');
const path = require('node:path');

// Paths the invoking IDE or shell write continuously; relative to the watched root.
// '*suffix' matches any path ending in suffix, '**/name' any path segment called name.
// Extend with --tripwire-exclude.
const DEFAULT_EXCLUDES = [
  '.kiro/sessions', '.kiro/crew', '.kiro/crew-auth-staging', '.kiro/logs', '.kiro/session-index',
  '.kiro/cloud-cache', '.kiro/rendered-agents', '.kiro/workspace-roots',
  '.local/share/kiro-cli/run', '.local/share/kiro-cli/data.sqlite3', '.local/share/kiro-cli/data.sqlite3-wal',
  '.local/share/kiro-cli/data.sqlite3-shm', '.local/share/kiro-cli/feed.json', '.local/share/kiro-cli/feed-cache.json',
  '.local/share/kiro-cli/feed-cache.etag', '.local/share/kiro-cli/feed-cache.source',
  '.cache', '.npm', '.cargo', '.rustup', '.mise', 'workspace',
  '*.lock', '*_history', '*.zcompdump',
];
const REPO_EXCLUDES = ['bench/results', '**/node_modules', '**/target', '.git/index', '*.lock'];
const MAX_ENTRIES = 200000;
const MAX_REPORTED = 50;

function matchesPattern(rel, p) {
  if (p.startsWith('**/')) {
    const name = p.slice(3);
    return rel === name || rel.endsWith(`/${name}`) || rel.includes(`/${name}/`) || rel.startsWith(`${name}/`);
  }
  if (p.startsWith('*')) return rel.endsWith(p.slice(1));
  return rel === p || rel.startsWith(`${p}/`);
}

function excluded(rel, abs, ctx) {
  if (ctx.abs.some((a) => abs === a || abs.startsWith(a + path.sep))) return true;
  return ctx.patterns.some((p) => matchesPattern(rel, p));
}

function walk(root, rel, depth, ctx) {
  if (ctx.n++ > MAX_ENTRIES) { ctx.truncated = true; return; }
  const abs = path.join(root, rel);
  let st;
  try { st = fs.lstatSync(abs); } catch { return; }
  // A directory's own mtime also moves when an excluded child changes, so ancestors of excludes are not judged by it.
  const ancestorOfExclude = st.isDirectory() && ctx.patterns.some((p) => !p.startsWith('*') && p.replace(/^\*\*\//, '').startsWith(`${rel}/`));
  if (rel && !ancestorOfExclude && (st.mtimeMs > ctx.since || st.ctimeMs > ctx.since)) ctx.hits.push(abs);
  if (!st.isDirectory() || depth === 0) return;
  let names;
  try { names = fs.readdirSync(abs); } catch { return; }
  for (const n of names) {
    const r = rel ? `${rel}/${n}` : n;
    if (!excluded(r, path.join(root, r), ctx)) walk(root, r, depth - 1, ctx);
  }
}

/**
 * roots: [{dir, depth, exclude: [relative prefixes or '*suffix']}]. absExclude lists
 * absolute dirs to skip everywhere (output, cache, scratch). start() touches the marker;
 * check() returns {hits, total, truncated} for entries whose mtime or ctime is after it.
 */
function createTripwire({ markerPath, roots, extraExcludes = [], absExclude = [] }) {
  let since = 0;
  return {
    start() {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, '');
      since = fs.statSync(markerPath).mtimeMs;
    },
    check() {
      const ctx = { since, hits: [], n: 0, truncated: false, abs: absExclude.map((a) => path.resolve(a)), patterns: [] };
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue;
        ctx.patterns = [...(r.exclude || []), ...extraExcludes];
        walk(r.dir, '', r.depth, ctx);
      }
      return { hits: ctx.hits.slice(0, MAX_REPORTED), allHits: ctx.hits, total: ctx.hits.length, truncated: ctx.truncated };
    },
  };
}

const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const under = (p, dir) => p === dir || p.startsWith(dir + path.sep);

// Inside the mount namespace the real home is read-only, so a hit is another process writing
// (an IDE, a shell) and only informational. sandbox-exec leaves ~/Library writable, where system
// processes write all the time, so only hits under `flaggedInHome` (dirs macOS runs code from) are
// flagged, checked over every hit rather than the reported first 50. Without isolation every hit is flagged.
function tripwireFlags(trip, isolationMode, flaggedInHome = []) {
  if (isolationMode === 'none') {
    return [...(trip.total > 0 ? ['homeTripwire'] : []), ...(trip.truncated ? ['homeTripwireTruncated'] : [])];
  }
  if (isolationMode !== 'sandbox-exec') return [];
  const risky = trip.allHits.some((h) => flaggedInHome.some((w) => under(h, w) || under(realOr(h), w)));
  return risky ? ['homeTripwire'] : [];
}

module.exports = { createTripwire, tripwireFlags, DEFAULT_EXCLUDES, REPO_EXCLUDES };
