// SPDX-License-Identifier: Apache-2.0
// The driver's `report` command (scripts/bench/bench.js, scripts/bench/lib/run-report.js): its usage errors, that it
// writes report.json and report.md and nothing else, NO DATA for a skill with no judgments or no baseline, and that
// convention-control goes to the controls check and never to the label table. The full stubbed loop down to a labeled
// report is in stub-run.test.js. No model, AWS or network call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bench = require('../../../scripts/bench/bench');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { LABELS, VERDICTS } = require('../../../scripts/bench/lib/labels');
const helpers = require('./helpers');

const NOW = () => Date.parse('2026-11-12T12:00:00.000Z');
const README = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'bench',
  'README.md',
);

const capture = () => {
  const io = { text: '', errors: '' };
  io.out = (text) => {
    io.text += text;
  };
  io.err = (text) => {
    io.errors += text;
  };
  return io;
};
const report = (args) => {
  const io = capture();
  const code = bench.main(['report', ...args], io, {}, { now: NOW });
  return { code, io };
};
/** Every file under `dir`, relative and sorted. */
const filesUnder = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();

test('report: usage errors exit 64 with one line and a hint', () =>
  helpers.withFixtureCopy((dir) => {
    const cases = [
      [['--root', dir], /--skills is required: name the skills to report/],
      [
        ['--skills', 'brew-log', '--root', dir, '--max-usd', '5'],
        /--max-usd is not an option of report: it spends nothing/,
      ],
      [
        ['--skills', 'brew-log', '--root', dir, '--max-minutes', '5'],
        /--max-minutes is not an option of report/,
      ],
      [
        ['--skills', 'brew-log', '--root', dir, '--started-at', '2026-11-12'],
        /--started-at is not an option of report: it spends nothing/,
      ],
      [
        ['--skills', 'brew-log', '--root', dir, '--json'],
        /report always prints JSON; --json is an option of plan/,
      ],
      [
        ['--skills', 'no-such-skill', '--root', dir],
        /unknown skill\(s\) in --skills: no-such-skill/,
      ],
      [
        ['--skills', 'brew-log', '--root', dir, '--provider', 'stub'],
        /only in a run whose id is "stub"/,
      ],
    ];
    for (const [args, message] of cases) {
      const { code, io } = report(args);
      assert.equal(code, 64, args.join(' '));
      assert.match(io.errors, message);
      assert.match(io.errors, /Run with --help for usage\./);
      assert.equal(io.text, '');
    }
    assert.deepEqual(
      filesUnder(dir).filter((name) => name.startsWith('bench/out/')),
      [],
      'a refused report writes nothing',
    );
    const unknown = capture();
    assert.equal(bench.main(['reprot'], unknown, {}), 64);
    assert.match(unknown.errors, /the commands are plan, next, report/);
  }));

test('report: a run with no judgments yet writes report.json and report.md, every skill NO DATA, and nothing else', () =>
  helpers.withFixtureCopy((dir) => {
    const before = filesUnder(dir);
    const { code, io } = report([
      '--skills',
      'brew-log,pantry-note',
      '--root',
      dir,
      '--run',
      'r1',
    ]);
    assert.equal(code, 0, io.errors);
    assert.equal(io.errors, '');
    const layout = createLayout({ root: dir, runId: 'r1' });
    const line = JSON.parse(io.text);
    assert.deepEqual(line, {
      report: 'written',
      run_id: 'r1',
      report_json: layout.reportJson,
      report_md: layout.reportMd,
      controls_status: 'NONE',
      labels_published: true,
      labels: { 'brew-log': 'NO DATA', 'pantry-note': 'NO DATA' },
    });
    assert.deepEqual(
      filesUnder(dir).filter((name) => !before.includes(name)),
      ['bench/out/r1/report.json', 'bench/out/r1/report.md'],
    );
    const summary = helpers.readJson(layout.reportJson);
    const bySkill = Object.fromEntries(
      summary.skills.map((entry) => [entry.skill, entry]),
    );
    assert.deepEqual(bySkill['brew-log'].no_data, [
      "A counts 0 of the skill's 5 tasks, below 4 (12 of every 16)",
      "B counts 0 of the skill's 5 tasks, below 4 (12 of every 16)",
    ]);
    assert.deepEqual(bySkill['pantry-note'].no_data, [
      'the skill could not be read: plan does not run it: no baseline',
    ]);
    // 4 outcome tasks x 3 seats x 2 arms: one judge job per answer.
    assert.equal(bySkill['brew-log'].coverage.A.waiting, 24);
    assert.equal(summary.spend.ledger_calls, 0);
    const markdown = fs.readFileSync(layout.reportMd, 'utf8');
    assert.match(markdown, /\| `brew-log` \| \*\*NO DATA\*\* \|/);
    assert.match(markdown, /NO DATA because:\n\n- A counts 0 of/);
    if (process.platform !== 'win32')
      for (const file of [layout.reportJson, layout.reportMd])
        assert.equal(fs.statSync(file).mode & 0o777, 0o600, file);
    // A second report replaces the first and still writes nothing else.
    assert.equal(
      report(['--skills', 'brew-log', '--root', dir, '--run', 'r1']).code,
      0,
    );
    assert.deepEqual(
      helpers.readJson(layout.reportJson).skills.map((entry) => entry.skill),
      ['brew-log'],
    );
    assert.deepEqual(
      filesUnder(dir).filter((name) => !before.includes(name)),
      ['bench/out/r1/report.json', 'bench/out/r1/report.md'],
    );
  }));

test('report: a secret-shaped string from a record is redacted in both files', () =>
  helpers.withFixtureCopy((dir) => {
    const exclusions = helpers.readJson(
      path.join(dir, 'bench', 'exclusions.json'),
    );
    const keyId = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    exclusions.batches.b1.scenarios[0].reason = `blocked, key ${keyId} in the reply`;
    helpers.write(path.join(dir, 'bench', 'exclusions.json'), exclusions);
    const { code, io } = report(['--skills', 'brew-log', '--root', dir]);
    assert.equal(code, 0, io.errors);
    const layout = createLayout({ root: dir });
    for (const file of [layout.reportJson, layout.reportMd]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!text.includes(keyId), file);
      assert.match(text, /\[REDACTED_AWS_KEY_ID\]/, file);
    }
    assert.equal(
      JSON.parse(fs.readFileSync(layout.reportJson, 'utf8')).version,
      1,
    );
  }));

test('report: a quoted secret is redacted in report.json too, where JSON writes the quote as \\"', () =>
  helpers.withFixtureCopy((dir) => {
    const exclusions = helpers.readJson(
      path.join(dir, 'bench', 'exclusions.json'),
    );
    const secret = 'Q'.repeat(40);
    exclusions.batches.b1.scenarios[0].reason = `blocked, aws_secret_access_key="${secret}" in the reply`;
    helpers.write(path.join(dir, 'bench', 'exclusions.json'), exclusions);
    const { code, io } = report(['--skills', 'brew-log', '--root', dir]);
    assert.equal(code, 0, io.errors);
    const layout = createLayout({ root: dir });
    for (const file of [layout.reportJson, layout.reportMd]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(
        text.includes('aws_secret_access_key'),
        `${file} keeps the name`,
      );
      assert.ok(!text.includes(secret), file);
    }
  }));

/** The fixture copy with brew-log renamed to convention-control everywhere but its SKILL.md text. */
function asConventionControl(dir) {
  const control = 'convention-control';
  fs.renameSync(
    path.join(dir, 'skills', 'brew-log'),
    path.join(dir, 'skills', control),
  );
  fs.renameSync(
    path.join(dir, 'bench', 'baselines', 'brew-log'),
    path.join(dir, 'bench', 'baselines', control),
  );
  for (const name of filesUnder(dir).filter((file) => file.endsWith('.json'))) {
    const file = path.join(dir, name);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').split('brew-log').join(control),
    );
  }
  return control;
}

test('report: convention-control is a control, never a labeled skill; not run, it makes the controls FAIL', () =>
  helpers.withFixtureCopy((dir) => {
    const control = asConventionControl(dir);
    const { code, io } = report(['--skills', control, '--root', dir]);
    assert.equal(code, 0, io.errors);
    const line = JSON.parse(io.text);
    assert.equal(line.controls_status, 'FAIL');
    assert.equal(line.labels_published, false);
    assert.deepEqual(line.labels, {});
    const layout = createLayout({ root: dir });
    const summary = helpers.readJson(layout.reportJson);
    assert.deepEqual(summary.skills, []);
    assert.equal(summary.controls[control].status, 'NOT RUN');
    const markdown = fs.readFileSync(layout.reportMd, 'utf8');
    assert.ok(
      markdown.indexOf('**controls: FAIL**') < markdown.indexOf('## Labels'),
    );
    assert.match(
      markdown,
      /\| `convention-control` \| \*\*NOT RUN\*\* \| missing: /,
    );
  }));

test('report: a text that already starts with a redaction marker is not taken for a text too long to scan', () =>
  helpers.withFixtureCopy((dir) => {
    const file = path.join(dir, 'bench', 'exclusions.json');
    const exclusions = helpers.readJson(file);
    const reason = '[REDACTED: an earlier step removed text here] and more';
    exclusions.batches.b1.scenarios[0].reason = reason;
    helpers.write(file, exclusions);
    const { code, io } = report(['--skills', 'brew-log', '--root', dir]);
    assert.equal(code, 0, io.errors);
    const layout = createLayout({ root: dir });
    for (const name of [layout.reportJson, layout.reportMd])
      assert.ok(fs.readFileSync(name, 'utf8').includes(reason), name);
  }));

/** Every `.tmp-` file under `dir`: a failed write must leave none. */
const temporaryFiles = (dir) =>
  filesUnder(dir).filter((name) => name.includes('.tmp-'));

test('report: a text too long to scan is a usage error (64) that names the field, and nothing is written', () =>
  helpers.withFixtureCopy((dir) => {
    // An exclusion reason cannot be that long (formats.js), but a target_section of a task can: the warning that names
    // it, which the report carries, is the long text.
    const file = path.join(
      dir,
      'bench',
      'baselines',
      'brew-log',
      'tasks-b1.json',
    );
    const tasks = helpers.readJson(file);
    tasks.scenarios[0].target_section = 'x'.repeat(5000001);
    helpers.write(file, tasks);
    const { code, io } = report(['--skills', 'brew-log', '--root', dir]);
    assert.equal(code, 64, io.errors);
    assert.equal(io.text, '');
    assert.match(
      io.errors,
      /^error: report\.json field warnings\[\d+\] is a text of \d{7} characters, too long for the redactor to scan \(the limit is 5000000\); shorten it in the file it comes from\nRun with --help for usage\.\n$/,
    );
    assert.doesNotMatch(io.errors, /bug in the benchmark/);
    assert.deepEqual(
      filesUnder(dir).filter((name) => name.startsWith('bench/out/')),
      [],
    );
  }));

test('report: a report.md that cannot be replaced fails before report.json changes; the exit is 74, "cannot write", and no temporary file stays', () =>
  helpers.withFixtureCopy((dir) => {
    const layout = createLayout({ root: dir, runId: 'r1' });
    const args = ['--skills', 'brew-log', '--root', dir, '--run', 'r1'];
    assert.equal(report(args).code, 0);
    const json = fs.readFileSync(layout.reportJson, 'utf8');
    // A folder where report.md should be: the old json must stay beside the old state of the markdown.
    fs.rmSync(layout.reportMd);
    fs.mkdirSync(path.join(layout.reportMd, 'keep'), { recursive: true });
    // A second skill makes the new report.json differ from the old one, so a json that was replaced is seen.
    const { code, io } = report([
      ...args.slice(0, 1),
      'brew-log,pantry-note',
      ...args.slice(2),
    ]);
    assert.equal(code, 74, io.errors);
    assert.equal(
      io.errors,
      `error: cannot write file: it is a folder, not a file (${layout.reportMd})\n`,
    );
    assert.equal(io.text, '');
    assert.equal(fs.readFileSync(layout.reportJson, 'utf8'), json);
    assert.deepEqual(temporaryFiles(dir), []);
  }));

test('report: a rename that fails after the first one is exit 74 "cannot write" and leaves no temporary file', (t) => {
  helpers.withFixtureCopy((dir) => {
    const layout = createLayout({ root: dir, runId: 'r1' });
    let renames = 0;
    const real = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
      renames += 1;
      if (renames === 2)
        throw Object.assign(new Error('ENOSPC: no space left on device'), {
          code: 'ENOSPC',
          syscall: 'rename',
        });
      return real(from, to);
    });
    const { code, io } = report([
      '--skills',
      'brew-log',
      '--root',
      dir,
      '--run',
      'r1',
    ]);
    t.mock.restoreAll();
    assert.equal(code, 74, io.errors);
    assert.match(io.errors, /^error: cannot write file: /);
    assert.ok(io.errors.includes(layout.reportMd), io.errors);
    assert.equal(io.text, '');
    assert.equal(renames, 2, 'the first rename happened, the second failed');
    assert.deepEqual(temporaryFiles(dir), []);
    // Running the command again replaces both files.
    assert.equal(
      report(['--skills', 'brew-log', '--root', dir, '--run', 'r1']).code,
      0,
    );
    assert.ok(
      fs.existsSync(layout.reportJson) && fs.existsSync(layout.reportMd),
    );
  });
});

test('report: when a control fails, the line on stdout withholds the labels as report.md does', () =>
  helpers.withFixtureCopy((dir) => {
    // A control with no baseline is NOT RUN, so the controls FAIL beside a skill that is read.
    fs.cpSync(
      path.join(dir, 'skills', 'brew-log'),
      path.join(dir, 'skills', 'convention-control'),
      { recursive: true },
    );
    const { code, io } = report([
      '--skills',
      'brew-log,convention-control',
      '--root',
      dir,
    ]);
    assert.equal(code, 0, io.errors);
    const line = JSON.parse(io.text);
    assert.equal(line.controls_status, 'FAIL');
    assert.equal(line.labels_published, false);
    assert.deepEqual(line.labels, { 'brew-log': 'withheld (controls: FAIL)' });
    const markdown = fs.readFileSync(
      createLayout({ root: dir }).reportMd,
      'utf8',
    );
    assert.match(markdown, /\| `brew-log` \| withheld \(controls: FAIL\) \|/);
  }));

test('report: a run folder that cannot be written fails with "cannot write" (74), names report.json and leaves no temporary file', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0)
    return t.skip('needs a user that file modes apply to');
  return helpers.withFixtureCopy((dir) => {
    const layout = createLayout({ root: dir, runId: 'r1' });
    fs.mkdirSync(layout.runDir, { recursive: true });
    fs.chmodSync(layout.runDir, 0o500);
    try {
      const { code, io } = report([
        '--skills',
        'brew-log',
        '--root',
        dir,
        '--run',
        'r1',
      ]);
      assert.equal(code, 74, io.errors);
      assert.equal(
        io.errors,
        `error: cannot write file: permission denied (${layout.reportJson})\n`,
      );
      assert.deepEqual(temporaryFiles(dir), []);
      assert.ok(!fs.existsSync(layout.reportJson));
    } finally {
      fs.chmodSync(layout.runDir, 0o700);
    }
  });
});

test('report: a spend ledger that cannot be read gives spend null and a warning in the files, and exit 0', () =>
  helpers.withFixtureCopy((dir) => {
    const layout = createLayout({ root: dir, runId: 'r1' });
    fs.mkdirSync(path.dirname(layout.ledgerFile), { recursive: true });
    fs.writeFileSync(layout.ledgerFile, '{"type":"reserve"}\nnot json\n');
    const { code, io } = report([
      '--skills',
      'brew-log',
      '--root',
      dir,
      '--run',
      'r1',
    ]);
    assert.equal(code, 0, io.errors);
    const summary = helpers.readJson(layout.reportJson);
    assert.equal(summary.spend, null);
    const warning = summary.warnings.find((line) =>
      line.startsWith('the spend ledger could not be read: '),
    );
    assert.ok(warning, summary.warnings.join('\n'));
    assert.match(
      fs.readFileSync(layout.reportMd, 'utf8'),
      /The spend ledger could not be read\./,
    );
  }));

test("report: the run's reservations are told from expired ones by the command's clock", () =>
  helpers.withFixtureCopy((dir) => {
    const layout = createLayout({ root: dir, runId: 'r1' });
    const row = (id, usd, expires) =>
      JSON.stringify({
        type: 'reserve',
        id,
        ts: '2026-11-12T11:00:00.000Z',
        run: 'r1',
        label: `call ${id}`,
        usd,
        expires,
      });
    fs.mkdirSync(path.dirname(layout.ledgerFile), { recursive: true });
    // The command's clock is 12:00. `a` runs until 13:00 and is still reserved; `b` ended at 11:30 unsettled, so it is
    // counted as spent. A clock that is not the command's would call both expired.
    fs.writeFileSync(
      layout.ledgerFile,
      `${row('a', 0.25, '2026-11-12T13:00:00.000Z')}\n${row('b', 0.5, '2026-11-12T11:30:00.000Z')}\n`,
    );
    const { code, io } = report([
      '--skills',
      'brew-log',
      '--root',
      dir,
      '--run',
      'r1',
    ]);
    assert.equal(code, 0, io.errors);
    const { spend } = helpers.readJson(layout.reportJson);
    assert.equal(spend.run_reserved_usd, 0.25);
    assert.equal(spend.run_spent_usd, 0.5);
  }));

test('report: the warnings of the judge plans reach the report, and a skill that is not ready names its plan status', () =>
  helpers.withFixtureCopy((dir) => {
    // The rules heading is renamed: SKILL.md changed after the baseline (rules stale), and the tasks that exercise
    // `Rules` no longer find that heading, which only the task set of a judge plan says.
    const skillMd = path.join(dir, 'skills', 'brew-log', 'SKILL.md');
    fs.writeFileSync(
      skillMd,
      fs.readFileSync(skillMd, 'utf8').replace('## Rules', '## Steps'),
    );
    const { code, io } = report([
      '--skills',
      'brew-log',
      '--root',
      dir,
      '--run',
      'r1',
    ]);
    assert.equal(code, 0, io.errors);
    const { warnings } = helpers.readJson(
      createLayout({ root: dir, runId: 'r1' }).reportJson,
    );
    assert.ok(warnings.includes('brew-log: rules stale'), warnings.join('\n'));
    assert.ok(
      warnings.some((line) =>
        /^brew-log: b1\/\S+: target_section "Rules" is not a heading of SKILL\.md$/.test(
          line,
        ),
      ),
      warnings.join('\n'),
    );
  }));

test('the README table of the label rules lists the four labels in the order the code checks them', () => {
  const text = fs.readFileSync(README, 'utf8');
  const start = text.indexOf('## Labels and the report');
  const section = text.slice(
    start,
    text.indexOf('Each skill also gets a suggested verdict', start),
  );
  const listed = [...section.matchAll(/^\| (\d) +\| `([^`]+)`/gm)].map(
    (match) => [Number(match[1]), match[2]],
  );
  assert.deepEqual(listed, [
    [1, LABELS.helps],
    [2, LABELS.harm],
    [3, LABELS.conventions],
    [4, LABELS.none],
  ]);
});

test('the README table of the suggested verdict rules lists the verdicts in the order the code checks them', () => {
  const text = fs.readFileSync(README, 'utf8');
  const start = text.indexOf('Each skill also gets a suggested verdict');
  assert.ok(start > 0, 'the README has the suggested verdict rules');
  const section = text.slice(start, text.indexOf('`lib/report.js`', start));
  const listed = [...section.matchAll(/^\| (\d) +\| `([^`]+)`/gm)].map(
    (match) => [Number(match[1]), match[2]],
  );
  assert.deepEqual(listed, [
    [1, VERDICTS.keep],
    [2, VERDICTS.prune],
    [3, VERDICTS.leanKeep],
    [4, VERDICTS.leanPrune],
    [5, VERDICTS.closeCall],
  ]);
});
