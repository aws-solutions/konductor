// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for scripts/generate-notice.js's pure logic: license-expression
 * decomposition, name-based dedup/conflict detection, and output shape.
 * Does not invoke `cargo metadata` -- that path is exercised manually per
 * the script's own header comment, since it needs a real Rust toolchain.
 *
 * Run: node --test tests/scripts/generate-notice.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const gen = require('../../scripts/generate-notice.js');

test('decomposeLicense splits OR/AND/WITH and legacy slash form', () => {
  assert.deepEqual(gen.decomposeLicense('MIT OR Apache-2.0').sort(), [
    'Apache-2.0',
    'MIT',
  ]);
  assert.deepEqual(gen.decomposeLicense('Apache-2.0 AND ISC').sort(), [
    'Apache-2.0',
    'ISC',
  ]);
  assert.deepEqual(gen.decomposeLicense('MIT/Apache-2.0').sort(), [
    'Apache-2.0',
    'MIT',
  ]);
  assert.deepEqual(
    gen.decomposeLicense('(MIT OR Apache-2.0) AND Unicode-3.0').sort(),
    ['Apache-2.0', 'MIT', 'Unicode-3.0'],
  );
  assert.deepEqual(
    gen
      .decomposeLicense('Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT')
      .sort(),
    ['Apache-2.0', 'LLVM-exception', 'MIT'],
  );
});

test('mergeByName collapses same-name/same-license entries at different versions', () => {
  const merged = gen.mergeByName([
    { name: 'syn', version: '2.0.119', license: 'MIT OR Apache-2.0' },
    { name: 'syn', version: '3.0.5', license: 'MIT OR Apache-2.0' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'syn');
});

test('mergeByName throws when the same name resolves to different license expressions', () => {
  assert.throws(
    () =>
      gen.mergeByName([
        { name: 'example', version: '1.0.0', license: 'MIT' },
        { name: 'example', version: '2.0.0', license: 'Apache-2.0' },
      ]),
    /different license expressions/,
  );
});

test('collectThirdParty excludes path/workspace crates (null source) and requires a license', () => {
  const out = gen.collectThirdParty(
    [
      { name: 'konductor', version: '0.1.0', source: null, license: null },
      {
        name: 'serde',
        version: '1.0.229',
        source: 'registry+...',
        license: 'MIT OR Apache-2.0',
      },
    ],
    'test-graph',
  );
  assert.deepEqual(out, [
    { name: 'serde', version: '1.0.229', license: 'MIT OR Apache-2.0' },
  ]);
});

test('collectThirdParty fails closed on a third-party crate with no license field', () => {
  assert.throws(
    () =>
      gen.collectThirdParty(
        [
          {
            name: 'mystery',
            version: '1.0.0',
            source: 'registry+...',
            license: null,
          },
        ],
        'test-graph',
      ),
    /no resolved license field/,
  );
});

test('buildNoticeBody sorts components and legend deterministically and ends with one trailing newline', () => {
  const body = gen.buildNoticeBody([
    { name: 'zlib-crate', version: '1.0.0', license: 'Zlib' },
    { name: 'aaa-crate', version: '1.0.0', license: 'MIT OR Apache-2.0' },
  ]);
  const aaaLine = body.indexOf(
    'aaa-crate under the MIT OR Apache-2.0 license.',
  );
  const zlibLine = body.indexOf('zlib-crate under the Zlib license.');
  assert.ok(aaaLine >= 0 && zlibLine >= 0 && aaaLine < zlibLine);
  assert.ok(
    body.includes('Apache-2.0 - https://spdx.org/licenses/Apache-2.0.html'),
  );
  assert.ok(body.includes('Zlib - https://spdx.org/licenses/Zlib.html'));
  assert.equal(body.endsWith('\n'), true);
  assert.equal(body.endsWith('\n\n'), false);
});

test('asciiCompare orders independently of host locale settings', () => {
  assert.deepEqual(['b', 'A', 'a', 'B'].sort(gen.asciiCompare), [
    'A',
    'B',
    'a',
    'b',
  ]);
});

test('readRustVersion reads the rust-version field out of a real Cargo.toml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-notice-test-'));
  try {
    const cargoToml = path.join(dir, 'Cargo.toml');
    fs.writeFileSync(
      cargoToml,
      '[package]\nname = "example"\nversion = "0.1.0"\nrust-version = "1.75.0"\nedition = "2021"\n',
      'utf8',
    );
    assert.equal(gen.readRustVersion(cargoToml), '1.75.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRustVersion throws when the Cargo.toml does not exist', () => {
  const missingPath = path.join(
    os.tmpdir(),
    'generate-notice-test-does-not-exist',
    'Cargo.toml',
  );
  assert.throws(() => gen.readRustVersion(missingPath), /cannot find/);
});

test('readRustVersion throws when the Cargo.toml has no rust-version field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-notice-test-'));
  try {
    const cargoToml = path.join(dir, 'Cargo.toml');
    fs.writeFileSync(
      cargoToml,
      '[package]\nname = "example"\nversion = "0.1.0"\nedition = "2021"\n',
      'utf8',
    );
    assert.throws(
      () => gen.readRustVersion(cargoToml),
      /no rust-version field found/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertPlausibleComponentCount passes at and above the floor', () => {
  assert.doesNotThrow(() =>
    gen.assertPlausibleComponentCount(gen.MIN_PLAUSIBLE_COMPONENT_COUNT),
  );
  assert.doesNotThrow(() =>
    gen.assertPlausibleComponentCount(gen.MIN_PLAUSIBLE_COMPONENT_COUNT + 1),
  );
});

test('assertPlausibleComponentCount fails closed below the floor', () => {
  assert.throws(
    () =>
      gen.assertPlausibleComponentCount(gen.MIN_PLAUSIBLE_COMPONENT_COUNT - 1),
    /below the plausibility floor/,
  );
  assert.throws(
    () => gen.assertPlausibleComponentCount(0),
    /below the plausibility floor/,
  );
});

test('runCargoMetadata retries online after an --offline failure and returns the full parsed metadata object', (t) => {
  const packages = [
    {
      name: 'serde',
      version: '1.0.229',
      source: 'registry+...',
      license: 'MIT OR Apache-2.0',
    },
  ];
  const resolve = { root: null, nodes: [] };
  let call = 0;
  t.mock.method(childProcess, 'spawnSync', (cmd, args) => {
    call += 1;
    assert.equal(
      cmd,
      'rustup',
      'toolchain must be pinned via rustup run, not RUSTUP_TOOLCHAIN',
    );
    assert.deepEqual(args.slice(0, 3), ['run', '1.75.0', 'cargo']);
    assert.ok(args.includes('--locked'), 'every attempt must pass --locked');
    if (call === 1) {
      // First attempt (--offline) fails, e.g. registry cache not primed.
      assert.ok(args.includes('--offline'));
      return {
        status: 1,
        stdout: '',
        stderr: 'error: no matching package found (offline)',
      };
    }
    // Second attempt (online) succeeds.
    assert.ok(!args.includes('--offline'));
    return {
      status: 0,
      stdout: JSON.stringify({ packages, resolve }),
      stderr: '',
    };
  });
  const result = gen.runCargoMetadata('/fake/dir', '1.75.0');
  assert.equal(call, 2);
  assert.deepEqual(result, { packages, resolve });
});

test('runCargoMetadata fails closed with a combined error message when both attempts fail', (t) => {
  let call = 0;
  t.mock.method(childProcess, 'spawnSync', (_cmd, args) => {
    call += 1;
    assert.ok(args.includes('--locked'));
    return {
      status: 101,
      stdout: '',
      stderr:
        'error: the lock file needs to be updated but --locked was passed',
    };
  });
  assert.throws(
    () => gen.runCargoMetadata('/fake/dir', '1.75.0'),
    (err) => {
      assert.match(err.message, /tried --offline, then online, both --locked/);
      assert.match(err.message, /lock file needs to be updated/);
      return true;
    },
  );
  assert.equal(call, 2);
});

test('runCargoMetadata fails closed immediately (no retry) when rustup is not on PATH', (t) => {
  let call = 0;
  t.mock.method(childProcess, 'spawnSync', () => {
    call += 1;
    const error = new Error('spawnSync rustup ENOENT');
    error.code = 'ENOENT';
    return { error, status: null, stdout: '', stderr: '' };
  });
  assert.throws(
    () => gen.runCargoMetadata('/fake/dir', '1.75.0'),
    /rustup is not on PATH/,
  );
  assert.equal(
    call,
    1,
    'must not retry once rustup itself is confirmed missing',
  );
});

/**
 * Tests for reachablePackageIds(): the traversal that starts from a
 * graph's shipped-binary target(s) and follows only normal/build
 * dependency edges, never a dev-only edge.
 */

/** Builds a minimal `{packages, resolve}` metadata fixture from a root
 * package (with a `bin` target) and an edge list `[{name, id, kinds}]`,
 * where `kinds` is an array of dep_kind strings (`null` for normal,
 * `'build'`, or `'dev'`) attached to that single edge. */
function fixtureWithRootAndEdges(edges) {
  const rootId = 'path+file:///fake/root#0.1.0';
  const packages = [
    {
      id: rootId,
      name: 'root',
      version: '0.1.0',
      source: null,
      license: null,
      targets: [{ name: 'root', kind: ['bin'] }],
    },
    ...edges.map((e) => ({
      id: e.id,
      name: e.name,
      version: '1.0.0',
      source: 'registry+...',
      license: 'MIT',
      targets: [],
    })),
  ];
  const rootDeps = edges.map((e) => ({
    name: e.name,
    pkg: e.id,
    dep_kinds: e.kinds.map((kind) => ({ kind, target: null })),
  }));
  const nodes = [
    { id: rootId, deps: rootDeps, dependencies: [], features: [] },
    ...edges.map((e) => ({
      id: e.id,
      deps: [],
      dependencies: [],
      features: [],
    })),
  ];
  return { packages, resolve: { root: rootId, nodes } };
}

test('reachablePackageIds includes a normal dependency', () => {
  const metadata = fixtureWithRootAndEdges([
    { name: 'serde', id: 'reg#serde@1.0', kinds: [null] },
  ]);
  const reachable = gen.reachablePackageIds(metadata);
  assert.ok(reachable.has('reg#serde@1.0'));
});

test('reachablePackageIds includes a build dependency', () => {
  const metadata = fixtureWithRootAndEdges([
    { name: 'cc', id: 'reg#cc@1.0', kinds: ['build'] },
  ]);
  const reachable = gen.reachablePackageIds(metadata);
  assert.ok(reachable.has('reg#cc@1.0'));
});

test('reachablePackageIds excludes a dev-only dependency', () => {
  const metadata = fixtureWithRootAndEdges([
    { name: 'mockito', id: 'reg#mockito@1.0', kinds: ['dev'] },
  ]);
  const reachable = gen.reachablePackageIds(metadata);
  assert.ok(!reachable.has('reg#mockito@1.0'));
});

test('reachablePackageIds includes a dependency reachable via both a dev edge and a normal edge on the same entry', () => {
  const metadata = fixtureWithRootAndEdges([
    { name: 'tokio', id: 'reg#tokio@1.0', kinds: [null, 'dev'] },
  ]);
  const reachable = gen.reachablePackageIds(metadata);
  assert.ok(
    reachable.has('reg#tokio@1.0'),
    'a non-dev dep_kind on the edge must qualify it even though a dev dep_kind is also present',
  );
});

test('reachablePackageIds does not infinitely loop on a dependency cycle', () => {
  const rootId = 'path+file:///fake/root#0.1.0';
  const aId = 'reg#a@1.0';
  const bId = 'reg#b@1.0';
  const packages = [
    {
      id: rootId,
      name: 'root',
      version: '0.1.0',
      source: null,
      license: null,
      targets: [{ name: 'root', kind: ['bin'] }],
    },
    {
      id: aId,
      name: 'a',
      version: '1.0',
      source: 'registry+...',
      license: 'MIT',
      targets: [],
    },
    {
      id: bId,
      name: 'b',
      version: '1.0',
      source: 'registry+...',
      license: 'MIT',
      targets: [],
    },
  ];
  const resolve = {
    root: rootId,
    nodes: [
      {
        id: rootId,
        deps: [
          { name: 'a', pkg: aId, dep_kinds: [{ kind: null, target: null }] },
        ],
        dependencies: [],
        features: [],
      },
      {
        id: aId,
        deps: [
          { name: 'b', pkg: bId, dep_kinds: [{ kind: null, target: null }] },
        ],
        dependencies: [],
        features: [],
      },
      {
        id: bId,
        // Cycle back to `a`.
        deps: [
          { name: 'a', pkg: aId, dep_kinds: [{ kind: null, target: null }] },
        ],
        dependencies: [],
        features: [],
      },
    ],
  };
  const reachable = gen.reachablePackageIds({ packages, resolve });
  assert.deepEqual([...reachable].sort(), [aId, bId, rootId].sort());
});

test('reachablePackageIds throws a clear error when resolve.nodes is missing', () => {
  assert.throws(
    () => gen.reachablePackageIds({ packages: [] }),
    /resolve\.nodes/,
  );
});

/**
 * Tests for generateNotice()'s per-graph vs. union plausibility checks.
 * Stubs childProcess.spawnSync (never invokes real cargo/rustup) and
 * fs.writeFileSync (never touches the real NOTICE.txt on disk).
 */

/** A `cargo metadata` success result carrying `count` synthetic
 * third-party crates, uniquely named with `namePrefix`, all reachable
 * from a synthetic root binary via normal dependency edges. */
function fakeMetadataSuccess(count, namePrefix) {
  const edges = [];
  for (let i = 0; i < count; i += 1) {
    edges.push({
      name: `${namePrefix}-${i}`,
      id: `registry+https://example.com#${namePrefix}-${i}@1.0.0`,
      kinds: [null],
    });
  }
  const metadata = fixtureWithRootAndEdges(edges);
  return { status: 0, stdout: JSON.stringify(metadata), stderr: '' };
}

/** Picks a per-graph fake result based on which graph directory cargo/rustup was invoked in. */
function fakeMetadataByGraph(cwd, cliResult, mcpResult) {
  if (cwd.endsWith(path.join('cli', 'konductor-rs'))) return cliResult;
  if (cwd.endsWith('mcp')) return mcpResult;
  throw new Error(`unexpected graph dir in test stub: ${cwd}`);
}

test('generateNotice succeeds and reports per-graph counts when both graphs are healthy', (t) => {
  t.mock.method(childProcess, 'spawnSync', (_cmd, _args, options) =>
    fakeMetadataByGraph(
      options.cwd,
      fakeMetadataSuccess(70, 'cli-crate'),
      fakeMetadataSuccess(65, 'mcp-crate'),
    ),
  );
  let written = null;
  t.mock.method(fs, 'writeFileSync', (filePath, content) => {
    written = { filePath, content };
  });

  const result = gen.generateNotice();

  assert.equal(
    result.componentCount,
    135,
    'no name overlap -- union is the simple sum',
  );
  assert.deepEqual(
    result.perGraphCounts.map((g) => g.uniqueNameCount),
    [70, 65],
  );
  assert.ok(written, 'must write NOTICE.txt exactly once');
  assert.ok(written.content.includes('cli-crate-0 under the MIT license.'));
  assert.ok(written.content.includes('mcp-crate-0 under the MIT license.'));
});

test('generateNotice throws naming the specific graph when one graph resolves near-empty', (t) => {
  t.mock.method(childProcess, 'spawnSync', (_cmd, _args, options) =>
    fakeMetadataByGraph(
      options.cwd,
      fakeMetadataSuccess(70, 'cli-crate'),
      fakeMetadataSuccess(0, 'mcp-crate'),
    ),
  );
  t.mock.method(fs, 'writeFileSync', () => {
    assert.fail('must not write NOTICE.txt when a per-graph check fails');
  });

  assert.throws(
    () => gen.generateNotice(),
    (err) => {
      assert.match(err.message, /graph "mcp" resolved only 0/);
      assert.match(err.message, /per-graph plausibility floor/);
      return true;
    },
  );
});

test('generateNotice throws naming the first graph when both graphs resolve near-empty', (t) => {
  t.mock.method(childProcess, 'spawnSync', (_cmd, _args, options) =>
    fakeMetadataByGraph(
      options.cwd,
      fakeMetadataSuccess(0, 'cli-crate'),
      fakeMetadataSuccess(0, 'mcp-crate'),
    ),
  );
  t.mock.method(fs, 'writeFileSync', () => {
    assert.fail('must not write NOTICE.txt when a per-graph check fails');
  });

  assert.throws(
    () => gen.generateNotice(),
    /graph "cli\/konductor-rs" resolved only 0/,
  );
});

test('generateNotice throws via the union backstop when both graphs clear their own floor but overlap down to a near-empty union', (t) => {
  // Both graphs independently resolve 65 crates (clears the per-graph floor
  // of 60), but every name is shared between the two graphs, so the
  // deduplicated union collapses to 65 -- below the union floor of 100.
  t.mock.method(childProcess, 'spawnSync', (_cmd, _args, options) =>
    fakeMetadataByGraph(
      options.cwd,
      fakeMetadataSuccess(65, 'shared-crate'),
      fakeMetadataSuccess(65, 'shared-crate'),
    ),
  );
  t.mock.method(fs, 'writeFileSync', () => {
    assert.fail('must not write NOTICE.txt when the union backstop fails');
  });

  assert.throws(
    () => gen.generateNotice(),
    (err) => {
      assert.match(
        err.message,
        /only 65 unique third-party crate\(s\) resolved/,
      );
      assert.match(err.message, /plausibility floor of 100/);
      return true;
    },
  );
});
