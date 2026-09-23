#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * generate-notice.js — regenerate NOTICE.txt's third-party attribution
 * section from the real, resolved dependency graphs.
 *
 * This repository ships two independent Cargo graphs (cli/konductor-rs and
 * mcp), each with its own Cargo.lock. Both are statically linked into a
 * shipped binary (konductor, skill-lookup-mcp), so both need attributing.
 * For each graph, this script starts from that graph's shipped-binary
 * target(s) and walks the resolved dependency graph (`cargo metadata`'s
 * `resolve.nodes`), following only normal and build dependency edges --
 * never a dev-only edge -- so a dev-only test dependency is never
 * attributed as shipped (see reachablePackageIds). It then unions the two
 * graphs' reachable third-party sets, drops each graph's own first-party
 * path/workspace crates (Cargo reports those with a null `source`), and
 * writes the union — deduplicated by crate name, license expressions
 * reproduced verbatim as each crate declares them, never normalized — into
 * NOTICE.txt.
 *
 * Toolchain note: the transitive dependency tree declares a minimum
 * supported Rust version (see cli/konductor-rs/Cargo.toml's own
 * `rust-version` field and its comment), which cargo enforces at resolve
 * time. A machine whose default `rustc` predates that floor fails to
 * resolve metadata at all, so this script reads that field and runs every
 * `cargo metadata` call as `rustup run <version> cargo metadata ...` --
 * mirroring the empirically-verified idiom documented next to
 * cli/konductor-rs/Cargo.toml's `rust-version` field. Setting the
 * `RUSTUP_TOOLCHAIN` env var instead only works when the `cargo` found on
 * PATH is rustup's own shim; on a system-package-manager cargo it is a
 * silent no-op, so this script does not rely on it. `rustup` itself must be
 * on PATH -- if it is not, this script fails closed rather than falling
 * back to an unpinned toolchain.
 *
 * Usage:
 *   node scripts/generate-notice.js
 *
 * Exits non-zero (fail-closed) on any of:
 *   - `rustup` not being available on PATH
 *   - cargo metadata failing for either graph (offline, then online, both tried)
 *   - a crate resolving with no license field
 *   - the same crate name resolving to two different license expressions
 *     across the two graphs (or across versions within one graph)
 *   - either graph's own third-party count being implausibly low (checked
 *     independently, before unioning -- see MIN_PLAUSIBLE_GRAPH_COMPONENT_COUNT)
 *   - an implausibly low final union component count (backstop, see
 *     MIN_PLAUSIBLE_COMPONENT_COUNT)
 *
 * Running this script twice with no dependency changes in between produces
 * a byte-identical NOTICE.txt.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const NOTICE_PATH = path.join(REPO_ROOT, 'NOTICE.txt');
const RUST_VERSION_SOURCE = path.join(
  REPO_ROOT,
  'cli',
  'konductor-rs',
  'Cargo.toml',
);
const GRAPH_DIRS = [
  path.join(REPO_ROOT, 'cli', 'konductor-rs'),
  path.join(REPO_ROOT, 'mcp'),
];

// Well below the real count (173 unique crate names as of this writing) but
// well above zero -- catches a truncated/empty metadata result without being
// brittle to a legitimate, modest future dependency change.
//
// This is a backstop only. It runs on the UNION of both graphs, so a graph
// that silently returns an empty or near-empty package list can still clear
// this floor on the other graph's healthy count alone -- each graph's own
// count is validated independently, before unioning, via
// MIN_PLAUSIBLE_GRAPH_COMPONENT_COUNT below.
const MIN_PLAUSIBLE_COMPONENT_COUNT = 100;

// Measured per-graph unique third-party crate-name counts as of this
// writing: cli/konductor-rs resolves 120, mcp resolves 116. Set at half the
// smaller measured count -- enough headroom that legitimate dependency
// churn in either graph doesn't trip it, but far above what a truncated or
// empty `cargo metadata` result would produce.
const MIN_PLAUSIBLE_GRAPH_COMPONENT_COUNT = 60;

const NOTICE_HEADER_LINES = [
  'Konductor',
  'Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.',
  '',
  'Licensed under the Apache License Version 2.0 (the "License"). You may not',
  'use this file except in compliance with the License. A copy of the License is',
  'located at http://www.apache.org/licenses/',
  'or in the "license" file accompanying this file. This file is distributed on',
  'an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express',
  'or implied. See the License for the specific language governing permissions',
  'and limitations under the License.',
  '',
];

/** Reads the `rust-version` field out of a Cargo.toml. Fails closed. */
function readRustVersion(cargoTomlPath) {
  if (!fs.existsSync(cargoTomlPath)) {
    throw new Error(
      `cannot find ${cargoTomlPath} to derive the pinned toolchain version.`,
    );
  }
  const text = fs.readFileSync(cargoTomlPath, 'utf8');
  const match = text.match(/^rust-version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(
      `no rust-version field found in ${cargoTomlPath}. Failing closed.`,
    );
  }
  return match[1];
}

/**
 * Runs `cargo metadata` in `dir` with the toolchain pinned via
 * `rustup run <version> cargo metadata ...`. Setting the `RUSTUP_TOOLCHAIN`
 * env var instead only takes effect when the `cargo` on PATH is rustup's own
 * shim -- on a system-package-manager cargo it is a silent no-op, breaking
 * the determinism guarantee this script's own header documents. See
 * cli/konductor-rs/Cargo.toml's `rust-version` comment for the
 * empirically-verified `rustup run <version> cargo ...` idiom this mirrors.
 *
 * Always passes `--locked`: this repository's committed Cargo.lock is the
 * graph this script must attribute, and a resolve that's allowed to drift
 * from it can both rewrite Cargo.lock as a side effect and describe a
 * dependency graph that differs from what's actually shipped. Tries
 * --offline first (fast, no network); falls back to online resolution if
 * the local registry cache is not fully primed. Fails closed with a clear
 * error if both attempts fail -- including when both fail because the
 * lockfile is out of sync, which is exactly the case `--locked` exists to
 * catch rather than silently resolving around.
 *
 * Fails closed immediately, without attempting a second toolchain, if
 * `rustup` itself is not on PATH -- rather than silently falling back to
 * whatever unpinned toolchain a bare `cargo` would otherwise use.
 */
function runCargoMetadata(dir, toolchainVersion) {
  const baseArgs = [
    'run',
    toolchainVersion,
    'cargo',
    'metadata',
    '--format-version',
    '1',
    '--locked',
  ];
  const attempts = [baseArgs.concat(['--offline']), baseArgs];
  let lastError = '';
  for (const args of attempts) {
    const result = childProcess.spawnSync('rustup', args, {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(
          `rustup is not on PATH (needed to run "rustup run ${toolchainVersion} cargo metadata" and reliably pin the ` +
            "toolchain -- RUSTUP_TOOLCHAIN silently no-ops unless the cargo on PATH is rustup's own shim). " +
            'Install rustup, then retry. Failing closed rather than falling back to an unpinned toolchain.',
        );
      }
      lastError = String(result.error);
      continue;
    }
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout);
      } catch (err) {
        throw new Error(
          `cargo metadata for ${dir} produced unparseable JSON: ${err.message}`,
        );
      }
    }
    lastError =
      result.stderr || `cargo metadata exited with status ${result.status}`;
  }
  throw new Error(
    `cargo metadata failed for ${dir} (tried --offline, then online, both --locked, via "rustup run ${toolchainVersion} cargo"). ` +
      `Failing closed rather than emitting a possibly-truncated NOTICE or letting cargo re-resolve Cargo.lock. Last error:\n${lastError}`,
  );
}

/**
 * Determines which package IDs are actually reachable from this graph's
 * shipped binaries (workspace/path crates with a `bin` target) via a
 * normal or build dependency edge. `cargo metadata`'s flat `packages`
 * array is the ENTIRE resolved graph, including dev-dependencies and
 * build-dependencies of every workspace member -- a dev-only test crate
 * (e.g. `mockito`, `assert_cmd`) would be wrongly attributed as shipped if
 * this script filtered that flat list directly, contradicting this
 * script's own contract of attributing what's "statically linked into a
 * shipped binary" (see this file's header comment).
 *
 * Follows an edge if any of its `dep_kinds` has `kind` of `null` (normal)
 * or `"build"`. A package reachable via BOTH a dev edge and a non-dev
 * edge is still included -- the non-dev edge alone establishes that it
 * ships, so a dev-only entry on the SAME edge does not disqualify it.
 * Cycle-safe: a package ID already visited is never re-queued.
 */
function reachablePackageIds(metadata) {
  const resolve = metadata.resolve;
  if (!resolve || !Array.isArray(resolve.nodes)) {
    throw new Error(
      'cargo metadata output has no resolve.nodes -- cannot determine which packages are actually reachable from a shipped binary',
    );
  }
  const nodesById = new Map(resolve.nodes.map((n) => [n.id, n]));
  const rootIds = metadata.packages
    .filter(
      (p) =>
        p.source == null &&
        (p.targets || []).some((t) => (t.kind || []).includes('bin')),
    )
    .map((p) => p.id);

  const visited = new Set();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodesById.get(id);
    if (!node) continue;
    for (const dep of node.deps || []) {
      const followable = (dep.dep_kinds || []).some(
        (dk) => dk.kind === null || dk.kind === 'build',
      );
      if (!followable) continue;
      if (!visited.has(dep.pkg)) queue.push(dep.pkg);
    }
  }
  return visited;
}

/**
 * Filters a graph's packages down to real third-party components: a null
 * `source` means a path/workspace crate (this repo's own code), never
 * third-party. Fails closed on any surviving crate with no license field.
 */
function collectThirdParty(packages, graphLabel) {
  const out = [];
  for (const pkg of packages) {
    if (pkg.source == null) continue;
    if (!pkg.license) {
      throw new Error(
        `crate "${pkg.name}@${pkg.version}" (from ${graphLabel}) has no resolved license field. ` +
          'Failing closed rather than emitting an incomplete NOTICE.',
      );
    }
    out.push({ name: pkg.name, version: pkg.version, license: pkg.license });
  }
  return out;
}

/**
 * Deduplicates by crate name across both graphs. A crate resolved at two
 * versions with the SAME license expression collapses to one entry (the
 * NOTICE lists names, not versions). A crate resolved at two versions with
 * DIFFERENT license expressions fails closed -- that is a real edge case
 * needing a human decision, not a silent pick.
 */
function mergeByName(entries) {
  const byName = new Map();
  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (!existing) {
      byName.set(entry.name, entry);
      continue;
    }
    if (existing.license !== entry.license) {
      throw new Error(
        `crate "${entry.name}" resolves to different license expressions: ` +
          `"${existing.license}" (${existing.version}) vs "${entry.license}" (${entry.version}). ` +
          'Failing closed -- this needs a human decision, not a silent pick.',
      );
    }
  }
  return Array.from(byName.values());
}

/**
 * Fails closed if `count` is below the plausibility floor -- a signal of
 * truncated or empty `cargo metadata` output rather than a real, legitimate
 * dependency count. This is the union-level backstop; see
 * assertPlausibleGraphComponentCount for the per-graph check that runs
 * first, before the two graphs are unioned.
 */
function assertPlausibleComponentCount(count) {
  if (count < MIN_PLAUSIBLE_COMPONENT_COUNT) {
    throw new Error(
      `only ${count} unique third-party crate(s) resolved -- below the plausibility floor ` +
        `of ${MIN_PLAUSIBLE_COMPONENT_COUNT}. Failing closed rather than emitting a possibly-truncated NOTICE.`,
    );
  }
}

/**
 * Fails closed if a single graph's own unique third-party crate count is
 * below the per-graph plausibility floor, naming the graph. Runs
 * independently for each graph, before the two graphs are unioned -- a
 * graph that silently returns an empty or near-empty package list must not
 * be allowed to hide behind the other graph's healthy count clearing the
 * union-level floor (assertPlausibleComponentCount) alone.
 */
function assertPlausibleGraphComponentCount(count, graphLabel) {
  if (count < MIN_PLAUSIBLE_GRAPH_COMPONENT_COUNT) {
    throw new Error(
      `graph "${graphLabel}" resolved only ${count} unique third-party crate(s) -- below the per-graph ` +
        `plausibility floor of ${MIN_PLAUSIBLE_GRAPH_COMPONENT_COUNT}. Failing closed rather than letting ` +
        "this graph's count silently ride along on the other graph clearing the union-level floor alone.",
    );
  }
}

/** Plain ASCII ordering -- deterministic regardless of host locale. */
function asciiCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Splits an SPDX license expression into its constituent identifiers.
 * Handles the compound forms actually seen in this repo's dependency tree:
 * "MIT OR Apache-2.0", "Apache-2.0 AND ISC", "MIT/Apache-2.0" (legacy slash
 * form, reproduced verbatim in the component line but still decomposed here
 * for the legend), "(MIT OR Apache-2.0) AND Unicode-3.0", and
 * "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT".
 */
function decomposeLicense(expression) {
  const flattened = expression.replace(/[()]/g, ' ');
  const parts = flattened.split(/\s+(?:OR|AND|WITH)\s+|\//);
  const ids = new Set();
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) ids.add(trimmed);
  }
  return Array.from(ids);
}

/** Builds the full NOTICE.txt text from a deduplicated component list. */
function buildNoticeBody(components) {
  const componentLines = components
    .slice()
    .sort((a, b) => asciiCompare(a.name.toLowerCase(), b.name.toLowerCase()))
    .map((c) => `${c.name} under the ${c.license} license.`);

  const licenseIds = new Set();
  for (const c of components) {
    for (const id of decomposeLicense(c.license)) licenseIds.add(id);
  }
  const legendLines = Array.from(licenseIds)
    .sort(asciiCompare)
    .map((id) => `${id} - https://spdx.org/licenses/${id}.html`);

  const lines = [
    ...NOTICE_HEADER_LINES,
    '**********************',
    'THIRD PARTY COMPONENTS',
    '**********************',
    '',
    'This software includes third party software subject to the following copyrights:',
    '',
    ...componentLines,
    '',
    '**********************',
    'OPEN SOURCE LICENSES',
    '**********************',
    '',
    ...legendLines,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Runs the full NOTICE generation pipeline: resolves both Cargo graphs,
 * validates each graph's own third-party count independently before
 * unioning (see assertPlausibleGraphComponentCount), merges the union by
 * crate name, validates the union count as a backstop
 * (assertPlausibleComponentCount), and writes NOTICE.txt.
 *
 * Returns a report object rather than writing to console directly, so
 * tests can assert on the outcome without capturing stdout. Writing to
 * NOTICE_PATH is the one side effect this function performs itself.
 */
function generateNotice() {
  const toolchainVersion = readRustVersion(RUST_VERSION_SOURCE);
  const allEntries = [];
  const perGraphCounts = [];
  for (const dir of GRAPH_DIRS) {
    const graphLabel = path.relative(REPO_ROOT, dir);
    const metadata = runCargoMetadata(dir, toolchainVersion);
    const reachableIds = reachablePackageIds(metadata);
    const reachablePackages = metadata.packages.filter((p) =>
      reachableIds.has(p.id),
    );
    const entries = collectThirdParty(reachablePackages, graphLabel);
    const uniqueNameCount = new Set(entries.map((e) => e.name)).size;
    assertPlausibleGraphComponentCount(uniqueNameCount, graphLabel);
    perGraphCounts.push({ graphLabel, uniqueNameCount });
    allEntries.push(...entries);
  }
  const merged = mergeByName(allEntries);
  assertPlausibleComponentCount(merged.length);
  const content = buildNoticeBody(merged);
  fs.writeFileSync(NOTICE_PATH, content, 'utf8');
  return {
    componentCount: merged.length,
    perGraphCounts,
    noticePath: NOTICE_PATH,
  };
}

/** CLI wrapper: runs generateNotice() and prints its report. */
function main() {
  const result = generateNotice();
  console.log(
    `Wrote ${result.noticePath}: ${result.componentCount} third-party component(s).`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  readRustVersion,
  runCargoMetadata,
  reachablePackageIds,
  collectThirdParty,
  mergeByName,
  decomposeLicense,
  buildNoticeBody,
  asciiCompare,
  assertPlausibleComponentCount,
  assertPlausibleGraphComponentCount,
  generateNotice,
  main,
  MIN_PLAUSIBLE_COMPONENT_COUNT,
  MIN_PLAUSIBLE_GRAPH_COMPONENT_COUNT,
};
