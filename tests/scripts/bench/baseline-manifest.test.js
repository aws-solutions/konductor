// SPDX-License-Identifier: Apache-2.0
// Tests for the baseline manifest and its check (scripts/bench/lib/baseline-manifest.js and baseline-manifest.js).
// They run against throw-away copies of the committed fixture repository.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const formats = require('../../../scripts/bench/lib/formats');
const {
  buildManifest,
  writeManifest,
  verifyBaselines,
  scanText,
  scanFile,
} = require('../../../scripts/bench/lib/baseline-manifest');
const { main } = require('../../../scripts/bench/baseline-manifest');
const { fileSha256 } = require('../../../scripts/bench/lib/provenance');
const helpers = require('./helpers');

const SKILL_FILES = [
  'brew-log/rules.json',
  'brew-log/tasks-b1.buckets.json',
  'brew-log/tasks-b1.json',
];
// Secret-shaped and home-directory text is built from pieces, so no source line is itself a finding.
const KEY_ID = ['AKIA', 'QWERTYUIOPASDFGH'].join('');
const HOME_FILE = `${['', 'Users'].join('/')}/jane/work`;
const NUMBER = ['9876', '5432', '1098'].join('');

/** A copy of the fixture with a manifest written for it. */
function withManifest(callback) {
  return helpers.withFixtureCopy((dir, layout) => {
    writeManifest(layout);
    return callback(dir, layout);
  });
}
const baselineFile = (layout, name) => path.join(layout.baselinesDir, name);
const appendTo = (file, text) => fs.appendFileSync(file, text);

test('writeManifest lists every baseline file with its SHA-256, in name order, in the manifest format', () => {
  helpers.withFixtureCopy((dir, layout) => {
    writeManifest(layout);
    const { data } = formats.loadChecked('manifest', layout.manifestFile);
    assert.deepEqual(Object.keys(data.files), SKILL_FILES);
    for (const name of SKILL_FILES)
      assert.equal(
        data.files[name],
        fileSha256(baselineFile(layout, name)),
        name,
      );
    assert.deepEqual(buildManifest(layout), data);
    assert.ok(fs.readFileSync(layout.manifestFile, 'utf8').endsWith('}\n'));
  });
});

test('a written manifest verifies clean on the fixture, and the check counts files and skills', () => {
  withManifest((dir, layout) => {
    assert.deepEqual(verifyBaselines(layout), {
      problems: [],
      warnings: [],
      fileCount: 3,
      skillCount: 1,
    });
  });
});

test('no manifest is a problem, and the files are still checked', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(baselineFile(layout, 'brew-log/tasks-b1.json'), (tasks) => {
      tasks.scenarios[0].prompt += ` Account ${NUMBER}.`;
    });
    const { problems } = verifyBaselines(layout);
    assert.equal(problems.length, 2);
    assert.equal(problems[0], 'MANIFEST.json: file is missing');
    assert.match(problems[1], /^brew-log\/tasks-b1\.json: 1 12-digit number/);
  });
});

test('a changed file is a hash problem, and a changed rules file also makes its tasks stale', () => {
  withManifest((dir, layout) => {
    appendTo(baselineFile(layout, 'brew-log/rules.json'), '\n');
    const { problems, warnings } = verifyBaselines(layout);
    assert.deepEqual(problems, [
      'brew-log/rules.json: hash differs from MANIFEST.json',
    ]);
    assert.deepEqual(warnings, [
      'brew-log: tasks-b1.json is stale, rules.json changed since the tasks were written',
    ]);
  });
});

test('a file the manifest does not list, and a listed file that is gone, are both named', () => {
  withManifest((dir, layout) => {
    fs.copyFileSync(
      baselineFile(layout, 'brew-log/tasks-b1.buckets.json'),
      baselineFile(layout, 'brew-log/tasks-b2.buckets.json'),
    );
    fs.rmSync(baselineFile(layout, 'brew-log/tasks-b1.json'));
    const { problems } = verifyBaselines(layout);
    assert.ok(
      problems.includes(
        'brew-log/tasks-b2.buckets.json: not listed in MANIFEST.json',
      ),
    );
    assert.ok(
      problems.includes(
        'brew-log/tasks-b1.json: listed in MANIFEST.json but not on disk',
      ),
    );
  });
});

test('anything that is not a baseline file is a problem: a stray name, a folder, a link, a file beside the skills', () => {
  withManifest((dir, layout) => {
    const folder = path.join(layout.baselinesDir, 'brew-log');
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'x');
    fs.mkdirSync(path.join(folder, 'tasks-b9.json'));
    fs.symlinkSync(
      path.join(folder, 'rules.json'),
      path.join(folder, 'tasks-b8.json'),
    );
    fs.writeFileSync(path.join(layout.baselinesDir, 'README.md'), 'x');
    const { problems } = verifyBaselines(layout);
    for (const name of ['notes.txt', 'tasks-b9.json', 'tasks-b8.json'])
      assert.ok(
        problems.some((problem) =>
          problem.startsWith(`brew-log/${name}: not a baseline file`),
        ),
        name,
      );
    assert.ok(
      problems.includes(
        'README.md: only a skill folder and MANIFEST.json belong in bench/baselines/',
      ),
    );
  });
});

test('a file that fails its format is a problem even when the manifest holds its hash', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(baselineFile(layout, 'brew-log/tasks-b1.json'), (tasks) => {
      delete tasks.scenarios;
    });
    writeManifest(layout);
    const { problems } = verifyBaselines(layout);
    assert.deepEqual(problems, [
      'brew-log/tasks-b1.json: scenarios: required field is missing',
    ]);
  });
});

test('a baseline whose skill has no SKILL.md is a problem, not a crash', () => {
  withManifest((dir, layout) => {
    fs.rmSync(layout.skillMd('brew-log'));
    const { problems } = verifyBaselines(layout);
    assert.deepEqual(problems, [
      'brew-log: a file it needs is missing (skills/brew-log/SKILL.md)',
    ]);
  });
});

test('a folder or file that cannot be read stops the check with the system error', () => {
  helpers.withTmp((dir) => {
    const layout = require('../../../scripts/bench/lib/layout').createLayout({
      root: dir,
    });
    assert.throws(
      () => verifyBaselines(layout),
      (error) => error.code === 'ENOENT' && error.path === layout.baselinesDir,
    );
  });
});

test('scanText finds a credential-shaped string, a home-directory path and a 12-digit number, and prints none of them', () => {
  const text = `key ${KEY_ID}, file ${HOME_FILE}/x, account ${NUMBER}`;
  const findings = scanText('s/rules.json', text);
  assert.equal(findings.length, 3);
  assert.match(
    findings[0],
    /^s\/rules\.json: credential-shaped text \(aws_key_id, 1 found\)$/,
  );
  assert.match(findings[1], /home-directory path/);
  assert.match(findings[2], /1 12-digit number\(s\).*ends in 1098\)/);
  for (const secret of [KEY_ID, HOME_FILE, NUMBER])
    assert.ok(!findings.join('\n').includes(secret));
});

test('scanText accepts the AWS example key, the documented account ids and a 12-digit run inside a hash', () => {
  const docIds = ['123456789012', '111122223333', '444455556666'];
  const hash = `5bd715a75f273cb46d8f4a40bf${NUMBER}df5b9f7a7c7c1ec284c0a28a2`;
  const text = [
    'AKIAIOSFODNN7EXAMPLE',
    ...docIds.map((id) => `arn:aws:iam::${id}:root`),
    hash,
    `${NUMBER}1`,
    `/users/{id}/photos and ${['', 'home', 'feed'].join('/')}`,
  ].join(' ');
  assert.deepEqual(scanText('s/tasks-b1.json', text), []);
  assert.equal(scanText('s/tasks-b1.json', `a ${NUMBER}.`).length, 1);
  assert.equal(scanText('s/tasks-b1.json', `C:\\\\Users\\\\jane`).length, 1);
});

test('the check reports a finding in a file that the manifest lists, and the finding names the file', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(baselineFile(layout, 'brew-log/tasks-b1.json'), (tasks) => {
      tasks.scenarios[0].prompt += ` Account ${NUMBER}.`;
    });
    writeManifest(layout);
    const { problems } = verifyBaselines(layout);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^brew-log\/tasks-b1\.json: 1 12-digit number/);
  });
});

test('scanText finds a private key header, a GitHub, Slack or Google key and a JWT, and not prose that names them', () => {
  const shapes = {
    private_key: ['-----BEGIN RSA', ' PRIVATE KEY-----'].join(''),
    github_token: ['gh', 'p_', 'a1B2c3D4'.repeat(5)].join(''),
    slack_token: ['xo', 'xb-', '1234567890-abcdefghijkl'].join(''),
    google_api_key: ['AI', 'zaSy', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'].join(
      '',
    ),
    jwt: [
      'ey',
      'JhbGciOiJIUzI1NiJ9.',
      'ey',
      'JzdWIiOiIxMjM0NTY3.abcdefghijk',
    ].join(''),
  };
  for (const [name, value] of Object.entries(shapes))
    assert.deepEqual(
      scanText('s/tasks-b1.json', `see ${value} here`),
      [`s/tasks-b1.json: credential-shaped text (${name}, 1 found)`],
      name,
    );
  assert.deepEqual(
    scanText(
      's/tasks-b1.json',
      'Rotate the private key, the GitHub token (ghp_ prefix) and the Slack xoxb token.',
    ),
    [],
  );
});

test('a manifest that cannot be written leaves no temporary file and no half manifest', () => {
  helpers.withFixtureCopy((dir, layout) => {
    fs.mkdirSync(layout.manifestFile);
    assert.throws(
      () => writeManifest(layout),
      (error) => error.writing === true && error.syscall === 'rename',
    );
    assert.deepEqual(fs.readdirSync(layout.baselinesDir).sort(), [
      'MANIFEST.json',
      'brew-log',
    ]);
  });
});

test('the manifest format refuses an unknown version, a missing or extra field, a bad path and a bad hash', () => {
  const good = {
    format_version: 1,
    files: { 'brew-log/rules.json': 'a'.repeat(64) },
  };
  assert.deepEqual(formats.validateManifest(good).errors, []);
  assert.deepEqual(
    formats.validateManifest({ format_version: 1, files: {} }).errors,
    [],
  );
  const cases = [
    [{ ...good, format_version: 2 }, /format_version: unsupported value 2/],
    [{ format_version: 1 }, /files: required field is missing/],
    [{ ...good, extra: 1 }, /extra: unknown field/],
    [{ ...good, files: [] }, /files: must be an object/],
    [
      { ...good, files: { 'brew-log/notes.txt': 'a'.repeat(64) } },
      /files\.brew-log\/notes\.txt: key must be <skill>\/rules\.json/,
    ],
    [
      { ...good, files: { '../rules.json': 'a'.repeat(64) } },
      /key must be <skill>\/rules\.json/,
    ],
    [
      { ...good, files: { 'brew-log/rules.json': 'A'.repeat(64) } },
      /64 lowercase hex characters/,
    ],
  ];
  for (const [document, pattern] of cases)
    assert.match(formats.validateManifest(document).errors.join('\n'), pattern);
});

/** Runs the command and returns { code, out, err }. */
function run(argv, env) {
  const result = { out: '', err: '' };
  result.code = main(
    argv,
    {
      out: (text) => (result.out += text),
      err: (text) => (result.err += text),
    },
    env,
  );
  return result;
}

test('check exits 0 on a clean tree and prints one line', () => {
  withManifest((dir) => {
    const result = run(['check', '--root', dir]);
    assert.deepEqual(result, {
      code: 0,
      out: 'ok: 3 files of 1 skills match MANIFEST.json and pass the checks\n',
      err: '',
    });
  });
});

test('check exits 1 and prints one error line per problem on stderr, and a warning on stdout', () => {
  withManifest((dir, layout) => {
    appendTo(baselineFile(layout, 'brew-log/rules.json'), '\n');
    const result = run(['check', '--root', dir]);
    assert.equal(result.code, 1);
    assert.equal(
      result.err,
      'error: brew-log/rules.json: hash differs from MANIFEST.json\n',
    );
    assert.match(result.out, /^warning: brew-log: tasks-b1\.json is stale/);
    assert.ok(!result.out.includes('ok:'));
  });
});

test('write rewrites only MANIFEST.json, then checks', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const before = fs.readdirSync(dir, { recursive: true }).sort();
    const result = run(['write', '--root', dir]);
    assert.equal(result.code, 0, result.err);
    const after = fs.readdirSync(dir, { recursive: true }).sort();
    assert.deepEqual(
      after.filter((name) => !before.includes(name)),
      [path.join('bench', 'baselines', 'MANIFEST.json')],
    );
    appendTo(baselineFile(layout, 'brew-log/rules.json'), '\n');
    assert.equal(run(['check', '--root', dir]).code, 1);
    assert.equal(run(['write', '--root', dir]).code, 0);
  });
});

test('usage mistakes exit 64, a missing baselines folder exits 66, help exits 0', () => {
  helpers.withTmp((dir) => {
    assert.equal(run(['--help']).code, 0);
    assert.equal(run([]).code, 0);
    assert.match(run([]).out, /^Usage: /);
    for (const argv of [
      ['verify'],
      ['check', '--nope'],
      ['check', '--root'],
      ['check', '--root', dir, '--root', dir],
    ]) {
      const result = run(argv);
      assert.equal(result.code, 64, argv.join(' '));
      assert.match(result.err, /^error: /);
    }
    const missing = run(['check', '--root', dir]);
    assert.equal(missing.code, 66);
    assert.match(missing.err, /required folder is missing/);
  });
});

// ---- values behind a JSON escape, and what the format messages print ----------------------------------------------------

const json = (text) => `{"prompt": "${text}"}`;

test('scanFile finds a value that a JSON escape hides from the bytes: a newline, a tab, a no-break space, \\/ and \\u0041', () => {
  const home = ['', 'home', 'jane', 'work'].join('\\/');
  const cases = [
    [`Account:\\n${NUMBER}`, /12-digit number/],
    [`Account:\\t${NUMBER}`, /12-digit number/],
    [`Account:\\u00a0${NUMBER}`, /12-digit number/],
    [`see ${home}`, /home-directory path/],
    [`key \\u0041KIAQWERTYUIOPASDFGH`, /aws_key_id, 1 found/],
  ];
  for (const [text, expected] of cases) {
    const bytes = json(text);
    assert.deepEqual(
      scanText('s/tasks-b1.json', bytes),
      [],
      `the bytes alone hide ${text}`,
    );
    const found = scanFile('s/tasks-b1.json', bytes);
    assert.equal(found.length, 1, text);
    assert.match(found[0], expected, text);
  }
  // The same values in a key, and as a bare JSON number (not a string at all).
  assert.equal(scanFile('s/rules.json', `{"a\\n${NUMBER}": 1}`).length, 1);
  assert.equal(scanFile('s/rules.json', `{"account": ${NUMBER}}`).length, 1);
  // A value found by both readings is counted once, with the larger count.
  assert.deepEqual(scanFile('s/rules.json', json(`${KEY_ID} ${KEY_ID}`)), [
    's/rules.json: credential-shaped text (aws_key_id, 2 found)',
  ]);
  // A repeated key keeps one value when parsed, so the bytes hold more matches than the decoded text: the larger counts.
  assert.deepEqual(
    scanFile('s/rules.json', `{"a": "${KEY_ID}", "a": "${KEY_ID}"}`),
    ['s/rules.json: credential-shaped text (aws_key_id, 2 found)'],
  );
  // A number split over two strings is not one number, and a text that is not JSON is read as its bytes.
  assert.deepEqual(scanFile('s/rules.json', '["987654", "321098"]'), []);
  assert.equal(scanFile('s/rules.json', `not json ${NUMBER}`).length, 1);
});

test('the check finds an account number that a newline escape put on its own line in a task prompt', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(baselineFile(layout, 'brew-log/tasks-b1.json'), (tasks) => {
      tasks.scenarios[0].prompt += `\n${NUMBER}`;
    });
    writeManifest(layout);
    const { problems } = verifyBaselines(layout);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^brew-log\/tasks-b1\.json: 1 12-digit number/);
  });
});

// The bench reads a baseline through parseJson, which drops a leading UTF-8 byte order mark (Windows editors add one), so
// the format check accepts such a file. The scan has to read it as JSON as well.
test('scanFile reads a file that starts with a byte order mark as JSON, so an escaped value is still found', () => {
  const mark = '\ufeff';
  for (const [text, expected] of [
    [`Account:\\n${NUMBER}`, /12-digit number/],
    [`key \\u0041KIAQWERTYUIOPASDFGH`, /aws_key_id, 1 found/],
  ]) {
    const bytes = mark + json(text);
    assert.deepEqual(scanText('s/tasks-b1.json', bytes), [], text);
    const found = scanFile('s/tasks-b1.json', bytes);
    assert.equal(found.length, 1, text);
    assert.match(found[0], expected, text);
    // The same file without the mark gives the same finding.
    assert.deepEqual(scanFile('s/tasks-b1.json', json(text)), found, text);
  }
  // A mark anywhere else is not a byte order mark: the text is not JSON, so it is read as its bytes, which an escape hides.
  for (const misplaced of [
    `${json(`Account:\\n${NUMBER}`)}${mark}`,
    `{${mark}"a": "Account:\\n${NUMBER}"}`,
  ])
    assert.deepEqual(scanFile('s/tasks-b1.json', misplaced), [], misplaced);
});

test('the check finds an escaped account number in a task file that starts with a byte order mark', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const file = baselineFile(layout, 'brew-log/tasks-b1.json');
    const tasks = JSON.parse(fs.readFileSync(file, 'utf8'));
    tasks.scenarios[0].prompt += `\n${NUMBER}`;
    fs.writeFileSync(file, `\ufeff${JSON.stringify(tasks, null, 2)}\n`);
    writeManifest(layout);
    const { problems } = verifyBaselines(layout);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^brew-log\/tasks-b1\.json: 1 12-digit number/);
  });
});

test('a format message that quotes a secret or an account number is printed without it', () => {
  for (const value of [KEY_ID, NUMBER]) {
    helpers.withFixtureCopy((dir, layout) => {
      helpers.update(
        baselineFile(layout, 'brew-log/tasks-b1.json'),
        (tasks) => {
          tasks.format_version = value;
        },
      );
      writeManifest(layout);
      const { problems } = verifyBaselines(layout);
      assert.ok(
        problems.some((line) => line.includes('format_version')),
        problems.join('\n'),
      );
      assert.ok(!problems.join('\n').includes(value), problems.join('\n'));
    });
  }
  // A manifest that quotes a secret in its own format error is printed without it too.
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(layout.manifestFile, { format_version: KEY_ID, files: {} });
    const { problems } = verifyBaselines(layout);
    assert.ok(problems.some((line) => line.startsWith('MANIFEST.json: ')));
    assert.ok(!problems.join('\n').includes(KEY_ID), problems.join('\n'));
  });
  // The documented example account is not masked.
  assert.equal(
    scanText('s/rules.json', 'arn:aws:iam::123456789012:root').length,
    0,
  );
});

test('scanText: a Linux home path, a canary, several matches of one shape and the length and letter boundaries of each shape', () => {
  assert.match(
    scanText('s/rules.json', `see ${['', 'home', 'jane', 'x'].join('/')}`)[0],
    /home-directory path/,
  );
  const canary = `bench-canary-${'0123456789abcdef'.repeat(2)}`;
  assert.match(scanText('s/rules.json', canary)[0], /canary/);
  const count = (text) => {
    const found = scanText('s/rules.json', text);
    return found.length ? Number(/(\d+) found/.exec(found[0])[1]) : 0;
  };
  const github = (body) => `gh${'p'}_${body}`;
  const shapes = {
    github: (n) => github('a'.repeat(n)),
    slack: (n) => `xoxb-${'a'.repeat(n)}`,
    google: (n) => `AIza${'a'.repeat(n)}`,
    jwt: (n) => `eyJ${'a'.repeat(n)}.eyJ${'a'.repeat(n)}.${'a'.repeat(n)}`,
  };
  assert.equal(count(`${shapes.github(30)} ${shapes.github(30)}`), 2);
  assert.equal(count(shapes.github(29)), 0);
  assert.equal(count(`github_pat_${'a'.repeat(30)}`), 1);
  for (const letter of ['o', 'u', 's', 'r'])
    assert.equal(count(`gh${letter}_${'a'.repeat(30)}`), 1, letter);
  assert.equal(count(`${shapes.slack(20)} ${shapes.slack(20)}`), 2);
  assert.equal(count(shapes.slack(19)), 0);
  for (const letter of ['a', 'p', 'r', 's'])
    assert.equal(count(`xox${letter}-${'a'.repeat(20)}`), 1, letter);
  assert.equal(count(`${shapes.google(35)} ${shapes.google(35)}`), 2);
  assert.equal(count(shapes.google(34)), 0);
  assert.equal(count(shapes.google(36)), 0, 'a longer word is not a key');
  assert.equal(count(`${shapes.jwt(10)} ${shapes.jwt(10)}`), 2);
  assert.equal(count(shapes.jwt(9)), 0);
  const pem = ['-----BEGIN RSA PRIVATE', ' KEY-----'].join('');
  assert.equal(count(`${pem} ${pem}`), 2);
  // A 12-digit number needs a non-letter on each side: a letter in front or behind alone is "inside a word".
  assert.equal(scanText('s/rules.json', `a${NUMBER} `).length, 0);
  assert.equal(scanText('s/rules.json', ` ${NUMBER}a`).length, 0);
  assert.equal(scanText('s/rules.json', `(${NUMBER})`).length, 1);
  // Two numbers and two keys give their counts.
  assert.match(
    scanText('s/rules.json', `${NUMBER} ${NUMBER.replace('9', '8')}`)[0],
    /^s\/rules\.json: 2 12-digit number/,
  );
});

test('a stale rules file is a warning, a manifest that is not a regular file is named, and the manifest is indented', () => {
  helpers.withFixtureCopy((dir, layout) => {
    fs.appendFileSync(layout.skillMd('brew-log'), '\nAnother line.\n');
    writeManifest(layout);
    const result = verifyBaselines(layout);
    assert.deepEqual(result.problems, []);
    assert.ok(
      result.warnings.some((line) =>
        /^brew-log: rules\.json is stale, SKILL\.md changed/.test(line),
      ),
      result.warnings.join('\n'),
    );
    const text = fs.readFileSync(layout.manifestFile, 'utf8');
    assert.equal(
      text,
      `${JSON.stringify(JSON.parse(text), null, 2)}\n`,
      'two-space indent and a final newline',
    );
    fs.rmSync(layout.manifestFile);
    fs.symlinkSync(path.join(dir, 'elsewhere.json'), layout.manifestFile);
    const { problems } = verifyBaselines(layout);
    assert.ok(
      problems.includes(
        'MANIFEST.json: must be a regular file, not a folder or a link',
      ),
      problems.join('\n'),
    );
  });
});

test('a manifest that cannot be written names the manifest, not its temporary file', () => {
  helpers.withFixtureCopy((dir, layout) => {
    fs.mkdirSync(layout.manifestFile);
    assert.throws(
      () => writeManifest(layout),
      (error) => error.writing === true && error.path === layout.manifestFile,
    );
  });
});
