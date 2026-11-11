// SPDX-License-Identifier: Apache-2.0
// Exit codes and error output of the skill benchmark driver, through the real command line entry point
// (a child process running scripts/bench/bench.js), against throw-away copies of the committed fixture.
// 0 done, 1 plan refused, 64 usage, 66 missing input, 70 internal error, 74 I/O error.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const bench = require('../../../scripts/bench/bench');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;
const ROOT = helpers.fixtureRoot();
const BENCH_JS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'bench',
  'bench.js',
);
const FAULT_PRELOAD = path.join(__dirname, 'fault-preload.js');
const GOLDEN = path.join(helpers.FIXTURE_DIR, 'plan.brew-log.expected.txt');

/** Runs the driver as a child process. `fault` and `env` are optional; BENCH_DEBUG is never inherited. */
function runCli(args, { fault, env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  if (!('BENCH_DEBUG' in env)) delete childEnv.BENCH_DEBUG;
  const nodeArgs = [];
  if (fault) {
    nodeArgs.push('--require', FAULT_PRELOAD);
    childEnv.BENCH_TEST_FAULT = JSON.stringify(fault);
  }
  return spawnSync(process.execPath, [...nodeArgs, BENCH_JS, ...args], {
    encoding: 'utf8',
    env: childEnv,
  });
}
const planArgs = (root, ...more) => [
  'plan',
  '--skills',
  SKILL,
  '--root',
  root,
  ...more,
];
const STACK_FRAME = /\n\s+at \S+|node:internal/;

/** The failure must be one `error:` line on stderr, nothing on stdout and no stack trace. */
function assertOneLineFailure(child, code, expectedLine, name) {
  assert.equal(
    child.status,
    code,
    `${name}: exit code (stderr: ${child.stderr})`,
  );
  assert.equal(child.stdout, '', `${name}: nothing on stdout`);
  assert.equal(child.stderr, `${expectedLine}\n`, `${name}: stderr`);
  assert.doesNotMatch(child.stderr, STACK_FRAME, `${name}: no stack trace`);
}

test('exit 0: a plan that is within its limit; exit 1: a plan that is refused; 64: a usage error', () => {
  const done = runCli([
    'plan',
    '--skills',
    'brew-log,pantry-note',
    '--root',
    ROOT,
  ]);
  assert.deepEqual(
    [done.status, done.stderr, done.stdout],
    [0, '', fs.readFileSync(GOLDEN, 'utf8')],
  );

  const refused = runCli(planArgs(ROOT, '--max-usd', '1'));
  assert.equal(refused.status, 1);
  assert.match(
    refused.stdout,
    /Refused\n {2}the plan's upper estimate \(p90\) is \$4\.79, above max_usd \$1\.00/,
  );
  assert.equal(refused.stderr, '');

  const usage = runCli(['plan', '--skills', 'nope', '--root', ROOT]);
  assert.equal(usage.status, 64);
  assert.equal(usage.stdout, '');
  assert.match(
    usage.stderr,
    /^error: unknown skill\(s\) in --skills: nope .*\nRun with --help for usage\.\n$/,
  );
  assert.doesNotMatch(usage.stderr, STACK_FRAME);
});

test('--help documents every exit code and BENCH_DEBUG, and never lists exit code 2', () => {
  const help = runCli(['--help']);
  assert.deepEqual([help.status, help.stderr], [0, '']);
  assert.match(help.stdout, /--max-usd <n> .*plain decimal such as 2\.5/);
  for (const code of [0, 1, 64, 66, 70, 74])
    assert.match(
      help.stdout,
      new RegExp(`^ {2}${code} {2,}\\S`, 'm'),
      `exit code ${code}`,
    );
  assert.match(help.stdout, /BENCH_DEBUG=1/);
  assert.doesNotMatch(
    help.stdout,
    /^ {2}2 {2,}/m,
    'exit code 2 is reserved and never used',
  );
});

test('exit 74: a SKILL.md that is a folder instead of a file is an I/O error with one line and no stack trace', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const skillMd = layout.skillMd(SKILL);
    fs.rmSync(skillMd);
    fs.mkdirSync(skillMd);
    assertOneLineFailure(
      runCli(planArgs(dir)),
      74,
      `error: cannot read file: it is a folder, not a file (${skillMd})`,
      'SKILL.md is a folder',
    );
  });
});

test('exit 74: a baseline folder that is a plain file is an I/O error naming the path', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const baselineDir = layout.baselineDir(SKILL);
    fs.rmSync(baselineDir, { recursive: true });
    fs.writeFileSync(baselineDir, 'not a folder');
    assertOneLineFailure(
      runCli(planArgs(dir)),
      74,
      `error: cannot read folder: part of the path is not a folder (${baselineDir})`,
      'baseline folder is a file',
    );
  });
});

// A permission test cannot fail for a user who may read everything, and Windows ignores chmod.
const CAN_DENY_READ =
  process.platform !== 'win32' &&
  !(typeof process.getuid === 'function' && process.getuid() === 0);
test(
  'exit 74: an unreadable SKILL.md (permission denied) is an I/O error with one line and no stack trace',
  {
    skip:
      !CAN_DENY_READ &&
      'needs a user that file permissions apply to (not root, not Windows)',
  },
  () => {
    helpers.withFixtureCopy((dir, layout) => {
      const skillMd = layout.skillMd(SKILL);
      fs.chmodSync(skillMd, 0o000);
      try {
        assertOneLineFailure(
          runCli(planArgs(dir)),
          74,
          `error: cannot read file: permission denied (${skillMd})`,
          'SKILL.md is unreadable',
        );
      } finally {
        fs.chmodSync(skillMd, 0o644);
      }
    });
  },
);

// The I/O errors of the files a baseline is made of are 74, like SKILL.md, and not a "cannot be read as JSON" refusal.
const UNREADABLE_FILES = [
  ['rules.json', (layout) => layout.rulesFile(SKILL)],
  ['a task file', (layout) => layout.tasksFile(SKILL, 'b1')],
  ['a buckets file', (layout) => layout.bucketsFile(SKILL, 'b1')],
  ['bench/exclusions.json', (layout) => layout.exclusionsFile],
  [
    'an agent spec',
    (layout) => path.join(layout.agentsDir, 'k-developer.agent-spec.json'),
  ],
];
for (const [name, locate] of UNREADABLE_FILES) {
  test(`exit 74: ${name} that is a folder is an I/O error naming the path, not a bad-JSON refusal`, () => {
    helpers.withFixtureCopy((dir, layout) => {
      const file = locate(layout);
      fs.rmSync(file);
      fs.mkdirSync(file);
      assertOneLineFailure(
        runCli(planArgs(dir)),
        74,
        `error: cannot read file: it is a folder, not a file (${file})`,
        `${name} is a folder`,
      );
    });
  });
  test(
    `exit 74: ${name} that is unreadable (permission denied) is an I/O error naming the path`,
    {
      skip:
        !CAN_DENY_READ &&
        'needs a user that file permissions apply to (not root, not Windows)',
    },
    () => {
      helpers.withFixtureCopy((dir, layout) => {
        const file = locate(layout);
        fs.chmodSync(file, 0o000);
        try {
          assertOneLineFailure(
            runCli(planArgs(dir)),
            74,
            `error: cannot read file: permission denied (${file})`,
            `${name} is unreadable`,
          );
        } finally {
          fs.chmodSync(file, 0o644);
        }
      });
    },
  );
}

// A file that exists but cannot be checked is not a file that is absent. fs.existsSync answers false for both.
test(
  'exit 74: bench/exclusions.json that is a symlink loop is an I/O error, not an empty exclusions file',
  {
    skip:
      process.platform === 'win32' && 'symlinks need extra rights on Windows',
  },
  () => {
    helpers.withFixtureCopy((dir, layout) => {
      fs.rmSync(layout.exclusionsFile);
      fs.symlinkSync(layout.exclusionsFile, layout.exclusionsFile);
      assertOneLineFailure(
        runCli(planArgs(dir)),
        74,
        `error: cannot read file: too many symbolic links (${layout.exclusionsFile})`,
        'exclusions.json links to itself',
      );
    });
  },
);
test(
  'exit 74: a baseline folder that cannot be searched is an I/O error naming the path, not "file is missing"',
  {
    skip:
      !CAN_DENY_READ &&
      'needs a user that file permissions apply to (not root, not Windows)',
  },
  () => {
    helpers.withFixtureCopy((dir, layout) => {
      const folder = layout.baselineDir(SKILL);
      // Readable but not searchable: the names can be listed, and no file in it can be opened or checked.
      fs.chmodSync(folder, 0o444);
      try {
        assertOneLineFailure(
          runCli(planArgs(dir)),
          74,
          `error: cannot read file: permission denied (${layout.rulesFile(SKILL)})`,
          'baseline folder has no search permission',
        );
      } finally {
        fs.chmodSync(folder, 0o755);
      }
    });
  },
);

test(
  'exit 1 or 74 follows the agent spec names, not the order the folder is listed in: the first broken spec by name decides',
  {
    skip:
      !CAN_DENY_READ &&
      'needs a user that file permissions apply to (not root, not Windows)',
  },
  () => {
    // k-architect is read before k-developer. A spec with bad JSON is a refusal (1); one that cannot be read is an I/O error (74).
    for (const [unreadable, bad, status] of [
      ['k-developer', 'k-architect', 1],
      ['k-architect', 'k-developer', 74],
    ]) {
      helpers.withFixtureCopy((dir, layout) => {
        const specOf = (name) =>
          path.join(layout.agentsDir, `${name}.agent-spec.json`);
        fs.writeFileSync(specOf(bad), '{ not json');
        fs.chmodSync(specOf(unreadable), 0o000);
        try {
          assert.equal(
            runCli(planArgs(dir)).status,
            status,
            `${bad} has bad JSON, ${unreadable} is unreadable`,
          );
        } finally {
          fs.chmodSync(specOf(unreadable), 0o644);
        }
      });
    }
  },
);

test('exit 1: a selection with no skill to run is refused with one line that names each skill and its status', () => {
  // pantry-note has a SKILL.md and no baseline in the fixture.
  const child = runCli(['plan', '--skills', 'pantry-note', '--root', ROOT]);
  assert.deepEqual([child.status, child.stderr], [1, '']);
  assert.match(
    child.stdout,
    /\nRefused\n {2}no selected skill can be run: pantry-note \(no baseline\)\n$/,
  );
  // One skill that can be run is enough: the golden plan (brew-log and pantry-note) still exits 0.
  const mixed = runCli([
    'plan',
    '--skills',
    'brew-log,pantry-note',
    '--root',
    ROOT,
  ]);
  assert.equal(mixed.status, 0);
});

test('exit 1: an agent spec with bad JSON, a baseline with no task file, and a bad baseline with no agent are refusals that name the file', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(
      path.join(layout.agentsDir, 'k-developer.agent-spec.json'),
      '{ nope',
    );
    const child = runCli(planArgs(dir));
    assert.deepEqual([child.status, child.stderr], [1, '']);
    assert.match(child.stdout, /invalid agent spec/);
    assert.match(
      child.stdout,
      /Refused\n {2}brew-log: k-developer\.agent-spec\.json: cannot be read as JSON/,
    );
  });
  helpers.withFixtureCopy((dir, layout) => {
    fs.unlinkSync(layout.tasksFile(SKILL, 'b1'));
    const child = runCli(planArgs(dir));
    assert.deepEqual([child.status, child.stderr], [1, '']);
    assert.match(child.stdout, /invalid baseline/);
    assert.match(child.stdout, /no task file for skill "brew-log"/);
  });
  helpers.withFixtureCopy((dir, layout) => {
    for (const name of fs.readdirSync(layout.agentsDir))
      fs.unlinkSync(path.join(layout.agentsDir, name));
    helpers.write(layout.rulesFile(SKILL), '{ "format_version": ');
    const child = runCli(planArgs(dir));
    assert.deepEqual([child.status, child.stderr], [1, '']);
    assert.match(child.stdout, /invalid baseline/);
    assert.match(child.stdout, /rules\.json: cannot be read as JSON/);
  });
});

test('exit 66: a file that goes missing while the plan reads it is reported as missing, with one line and no stack trace', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const child = runCli(planArgs(dir), {
      fault: { file: path.join(SKILL, 'SKILL.md'), error: 'ENOENT' },
    });
    assertOneLineFailure(
      child,
      66,
      `error: required file is missing (${layout.skillMd(SKILL)})`,
      'SKILL.md vanished',
    );
  });
});

test('exit 70: a bug prints one line that says so, and a stack trace only with BENCH_DEBUG=1', () => {
  helpers.withFixtureCopy((dir) => {
    const fault = { file: path.join(SKILL, 'SKILL.md'), error: 'TypeError' };
    const quiet = runCli(planArgs(dir), { fault });
    assertOneLineFailure(
      quiet,
      70,
      'error: internal error, this is a bug in the benchmark: simulated bug. Set BENCH_DEBUG=1 to print the stack trace.',
      'a bug',
    );

    const debug = runCli(planArgs(dir), { fault, env: { BENCH_DEBUG: '1' } });
    assert.equal(debug.status, 70);
    assert.equal(debug.stdout, '');
    assert.match(
      debug.stderr,
      /^error: internal error, this is a bug in the benchmark: simulated bug\.\nTypeError: simulated bug\n\s+at /,
    );

    const notDebug = runCli(planArgs(dir), {
      fault,
      env: { BENCH_DEBUG: '0' },
    });
    assertOneLineFailure(
      notDebug,
      70,
      quiet.stderr.trimEnd(),
      'BENCH_DEBUG other than 1',
    );
  });
});

const BOM = '\uFEFF';

// `JSON.parse` keeps the last of two equal keys, so a repeated batch would silently drop the first record.
test('a key used twice in a baseline file is a problem that names the key and the line (exit 1), not a record that vanishes', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const realBatch = helpers.readJson(layout.exclusionsFile).batches.b1;
    fs.writeFileSync(
      layout.exclusionsFile,
      `{\n "format_version": 1,\n "batches": {\n  "b1": ${JSON.stringify(realBatch)},\n  "b1": { "scenarios": [] }\n }\n}\n`,
    );
    const child = runCli(planArgs(dir));
    assert.deepEqual([child.status, child.stderr], [1, '']);
    assert.match(
      child.stdout,
      /Refused\n {2}exclusions\.json: has the key "b1" twice in batches \(line 5\); remove one/,
    );
    assert.doesNotMatch(child.stdout, STACK_FRAME);
  });
  helpers.withFixtureCopy((dir, layout) => {
    const text = fs
      .readFileSync(layout.tasksFile(SKILL, 'b1'), 'utf8')
      .replace('"title":', '"title": "first", "title":');
    fs.writeFileSync(layout.tasksFile(SKILL, 'b1'), text);
    const child = runCli(planArgs(dir));
    assert.equal(child.status, 1);
    assert.match(
      child.stdout,
      /tasks-b1\.json: has the key "title" twice in scenarios\[0\] \(line \d+\)/,
    );
  });
  helpers.withFixtureCopy((dir) => {
    const settings = path.join(dir, 'settings.json');
    helpers.write(settings, '{ "max_usd": 5, "max_usd": 6 }');
    const child = runCli(planArgs(dir, '--config', settings));
    assert.equal(child.status, 64);
    assert.match(
      child.stderr,
      /settings\.json: has the key "max_usd" twice at the top level \(line 1\)/,
    );
  });
});

// Windows editors save UTF-8 with a byte order mark; the plan must read such a file as it reads any other.
test('a byte order mark at the start of a baseline file is ignored', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const pristine = runCli(planArgs(dir));
    assert.equal(pristine.status, 0);
    const settings = path.join(dir, 'settings.json');
    fs.writeFileSync(
      settings,
      `${BOM}${JSON.stringify(helpers.settingsWith({ max_usd: 20 }))}`,
    );
    for (const file of [
      layout.exclusionsFile,
      layout.tasksFile(SKILL, 'b1'),
      layout.bucketsFile(SKILL, 'b1'),
    ])
      fs.writeFileSync(file, BOM + fs.readFileSync(file, 'utf8'));
    const withBom = runCli(planArgs(dir, '--config', settings));
    assert.deepEqual([withBom.status, withBom.stderr], [0, '']);
    // Only the limit differs: the same tasks, the same exclusion warning, the same cost.
    assert.equal(
      withBom.stdout.replaceAll('$20.00', '$30.00'),
      pristine.stdout,
    );
  });
  helpers.withFixtureCopy((dir, layout) => {
    // The hash chain covers the bytes of rules.json, so a mark added there makes the task file stale
    // (a change of bytes) but is not a read error.
    fs.writeFileSync(
      layout.rulesFile(SKILL),
      BOM + fs.readFileSync(layout.rulesFile(SKILL), 'utf8'),
    );
    const child = runCli(planArgs(dir));
    assert.deepEqual([child.status, child.stderr], [0, '']);
    assert.match(child.stdout, /tasks stale/);
    assert.doesNotMatch(child.stdout, /cannot be read as JSON/);
  });
});

// Bad JSON is not a crash. Where it is reported depends on the file, and each of these is a documented code.
test('bad JSON: a baseline or exclusions file is listed as invalid (exit 1), a settings file is a usage error (64)', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(layout.rulesFile(SKILL), '{ "format_version": ');
    const rules = runCli(planArgs(dir));
    assert.deepEqual([rules.status, rules.stderr], [1, '']);
    assert.match(rules.stdout, /invalid baseline/);
    assert.match(rules.stdout, /rules\.json: cannot be read as JSON/);
    assert.doesNotMatch(rules.stdout, STACK_FRAME);
  });
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(layout.exclusionsFile, '{ nope');
    const exclusions = runCli(planArgs(dir));
    assert.deepEqual([exclusions.status, exclusions.stderr], [1, '']);
    assert.match(
      exclusions.stdout,
      /Refused\n {2}exclusions\.json: cannot be read as JSON/,
    );
  });
  helpers.withFixtureCopy((dir) => {
    const settings = path.join(dir, 'settings.json');
    helpers.write(settings, '{ nope');
    const child = runCli(planArgs(dir, '--config', settings));
    assert.equal(child.status, 64);
    assert.equal(child.stdout, '');
    assert.match(
      child.stderr,
      new RegExp(
        `^error: ${settings.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: cannot be read as JSON .*\\nRun with --help for usage\\.\\n$`,
      ),
    );
    assert.doesNotMatch(child.stderr, STACK_FRAME);
  });
});

test('a bug while reading the settings file is exit 70, not a settings error', () => {
  // Only a settings problem (ConfigError) becomes exit 64; a TypeError thrown inside the read is a bug.
  const child = runCli(planArgs(ROOT), {
    fault: { file: path.join('bench', 'config.json'), error: 'TypeError' },
  });
  assert.equal(child.status, 70, child.stderr);
  assert.match(
    child.stderr,
    /^error: internal error, this is a bug in the benchmark: simulated bug/,
  );
});

test('a settings file that is missing is a usage error (64), as before', () => {
  const child = runCli(
    planArgs(ROOT, '--config', path.join(helpers.FIXTURE_DIR, 'absent.json')),
  );
  assert.equal(child.status, 64);
  assert.match(
    child.stderr,
    /^error: .*absent\.json: cannot read the config file \(ENOENT\)\nRun with --help for usage\.\n$/,
  );
});

// describeFailure is the one place that picks a code. Each row is an error and the code it must get.
function systemError(code, syscall, file) {
  return Object.assign(new Error(`${code}: simulated, ${syscall} '${file}'`), {
    code,
    syscall,
    path: file,
  });
}
const FAILURES = [
  [
    'a missing file',
    systemError('ENOENT', 'open', '/x/a.json'),
    bench.EX_NOINPUT,
    'error: required file is missing (/x/a.json)',
  ],
  [
    'a missing folder',
    systemError('ENOENT', 'scandir', '/x/dir'),
    bench.EX_NOINPUT,
    'error: required folder is missing (/x/dir)',
  ],
  [
    'permission denied',
    systemError('EACCES', 'open', '/x/a.json'),
    bench.EX_IOERR,
    'error: cannot read file: permission denied (/x/a.json)',
  ],
  [
    'a folder read as a file',
    systemError('EISDIR', 'read', '/x/a.json'),
    bench.EX_IOERR,
    'error: cannot read file: it is a folder, not a file (/x/a.json)',
  ],
  [
    'an unlisted system code',
    systemError('EBUSY', 'open', '/x/a.json'),
    bench.EX_IOERR,
    'error: cannot read file: EBUSY (/x/a.json)',
  ],
  [
    'a system error with no path',
    Object.assign(new Error('EMFILE'), { code: 'EMFILE', syscall: 'open' }),
    bench.EX_IOERR,
    'error: cannot read file: too many open files',
  ],
  [
    'a TypeError',
    new TypeError('x is not a function'),
    bench.EX_SOFTWARE,
    'error: internal error, this is a bug in the benchmark: x is not a function. Set BENCH_DEBUG=1 to print the stack trace.',
  ],
  [
    'a RangeError',
    new RangeError('too big'),
    bench.EX_SOFTWARE,
    'error: internal error, this is a bug in the benchmark: too big. Set BENCH_DEBUG=1 to print the stack trace.',
  ],
  [
    'an error with a code but no syscall (not a system error)',
    Object.assign(new Error('bad argument'), { code: 'ERR_INVALID_ARG_TYPE' }),
    bench.EX_SOFTWARE,
    'error: internal error, this is a bug in the benchmark: bad argument. Set BENCH_DEBUG=1 to print the stack trace.',
  ],
  [
    'a thrown string',
    'oops',
    bench.EX_SOFTWARE,
    'error: internal error, this is a bug in the benchmark: oops. Set BENCH_DEBUG=1 to print the stack trace.',
  ],
  [
    'a multi-line message keeps its first line',
    new Error('first\nsecond'),
    bench.EX_SOFTWARE,
    'error: internal error, this is a bug in the benchmark: first. Set BENCH_DEBUG=1 to print the stack trace.',
  ],
];
for (const [name, error, code, firstLine] of FAILURES) {
  test(`describeFailure: ${name} gives exit ${code}`, () => {
    const failure = bench.describeFailure(error);
    assert.deepEqual([failure.code, failure.text], [code, `${firstLine}\n`]);
  });
}

test('describeFailure: the exit codes are distinct and none is 2', () => {
  const codes = [
    0,
    1,
    bench.EX_USAGE,
    bench.EX_NOINPUT,
    bench.EX_SOFTWARE,
    bench.EX_IOERR,
  ];
  assert.deepEqual(codes, [0, 1, 64, 66, 70, 74]);
  assert.equal(new Set(codes).size, codes.length);
});

// A config with no `anthropic` seat and no rubric_writer has no checklist writer for `plan` to price. That is a
// settings error that names the field (64), not a bug in the benchmark (70).
test('exit 64: no anthropic seat and no rubric_writer is a settings error naming models.rubric_writer; with a writer set, plan runs', () => {
  helpers.withFixtureCopy((dir) => {
    const configFile = path.join(dir, 'settings.json');
    helpers.write(
      configFile,
      helpers.edit(
        helpers.settingsWith(),
        'models.judges.anthropic',
        undefined,
      ),
    );
    const child = runCli(planArgs(dir, '--config', configFile));
    assert.equal(child.status, 64, child.stderr);
    assert.equal(child.stdout, '');
    assert.match(
      child.stderr,
      /^error: invalid benchmark settings \([^)]+\):\n {2}- models\.rubric_writer: set it, or keep an "anthropic" judge seat/,
    );
    assert.doesNotMatch(child.stderr, /internal error|bug in the benchmark/);

    helpers.write(
      configFile,
      helpers.edit(
        helpers.settingsWith({ models: { rubric_writer: 'writer-model' } }),
        'models.judges.anthropic',
        undefined,
      ),
    );
    const withWriter = runCli(planArgs(dir, '--config', configFile));
    assert.equal(withWriter.status, 0, withWriter.stderr);
  });
});
