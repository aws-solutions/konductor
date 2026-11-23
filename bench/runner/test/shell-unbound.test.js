// SPDX-License-Identifier: Apache-2.0
'use strict';

// The unbound-variable class check (DEBT D-157): bench/scripts/shell-unbound.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan, scanErrexit, scripts } = require('../../scripts/shell-unbound.js');

const sh = (...lines) => lines.join('\n');

test('a local bound only on the dry-run branch and read after it is found (the 2026-11-21 wave-0 PAID failure)', () => {
  const text = sh('#!/usr/bin/env bash', 'set -euo pipefail', 'arm_trial() {',
    '  if [ "$DRY" = 1 ]; then', '    local log=$S/dry.log', '    if [ -f x ]; then local pinbak=""; fi', '  else', '    run_paid', '  fi',
    '  echo "$log" "${pinbak}" "${log:-}"', '}');
  assert.deepEqual(scan(text).map((f) => [f.line, f.name]), [[10, 'log'], [10, 'pinbak']]);
});

test('a case arm and a loop body are branches too; a local bound at the top, a safe default and a script without set -u are not reported', () => {
  const text = sh('set -u', 'f() {', '  local log pinbak=""', '  if x; then log=a; fi', '  echo "$log $pinbak ${late:-} ${late2-x}"',
    '  case $1 in', '    a) local k=1; echo $k ;;', '    b) echo $k ;;', '  esac', '  for i in 1; do', '    local z=1', '  done', '  echo $z',
    '  if y; then', '    local w=1', '    echo "$w"', '  fi', '}');
  assert.deepEqual(scan(text).map((f) => [f.line, f.name]), [[8, 'k'], [13, 'z']]);
  assert.deepEqual(scan(text.replace('set -u', 'set -e')), []);
});

test('under set -e, an assignment whose $([ ] && ...) has no || is found (review 2026-11-23 F2, the paid cc plant check)', () => {
  const text = sh('#!/usr/bin/env bash', 'set -euo pipefail',
    'LOGDIR="$W/reports/x$([ "$DRY" = 1 ] && echo -dry)"',
    'OK="$W/x$([ "$DRY" = 1 ] && echo -dry || true)"',
    'f() {', '  local L=$([ -n "$x" ] && echo y)', '}',
    'T=$(test -f a && cat a)', 'echo "$([ -f b ] && echo b)"', 'X=$(cat f)');
  assert.deepEqual(scanErrexit(text).map((f) => f.line), [3, 8]);
  assert.deepEqual(scanErrexit(text.replace('set -euo pipefail', 'set -u')), []);
});

test('every bench shell script is clean', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const files = scripts([path.join(root, 'bench'), path.join(root, 'scripts')]);
  assert.ok(files.length > 20, `found ${files.length} scripts`);
  const bad = files.flatMap((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return [...scan(text).map((x) => `${path.relative(root, f)}:${x.line} ${x.name}`), ...scanErrexit(text).map((x) => `${path.relative(root, f)}:${x.line} errexit`)];
  });
  assert.deepEqual(bad, []);
});
