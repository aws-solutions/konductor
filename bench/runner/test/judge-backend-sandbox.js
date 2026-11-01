// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared setup for the judge backend CLI tests: a tiny bench, run directories, a fake opencode and a credentials file.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { makeFakeOpencodeJudge } = require('./fake-opencode-judge.js');

const BENCH = path.join(__dirname, '..', 'bench.js');
const FAKE_JUDGE = `node ${path.join(__dirname, 'fake-judge.js')}`;
const CREDS = '[bench]\naws_access_key_id = AKIATESTSECRET0001\naws_secret_access_key = SECRETVALUE-xyz\n';

function sandbox({ model } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const mkRun = (name, arms = ['vanilla', 'k']) => makeRun(path.join(root, name), bench, arms.map((arm) => ({ arm, rep: 1, finalText: `${arm} done`, files: { 'a.txt': `fixed by ${arm}\n` } })), model ? { model } : {});
  const fake = makeFakeOpencodeJudge(path.join(root, 'bin'), { dir: path.join(root, 'calls') });
  const creds = path.join(root, 'creds');
  fs.writeFileSync(creds, CREDS);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const tmpdir = path.join(root, 'tmpdir');
  fs.mkdirSync(tmpdir);
  const cli = (args, env = {}) => spawnSync('node', [BENCH, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir, ...env } });
  const oc = (run, ...extra) => cli(['judge', '--run', run, '--bench-dir', bench, '--judge-backend', 'opencode', '--opencode-bin', fake.file, '--aws-creds-file', creds, '--aws-profile', 'bench', '--aws-region', 'us-east-1', ...extra]);
  const calls = () => (fs.existsSync(path.join(root, 'calls')) ? fake.calls() : []);
  return { root, bench, mkRun, fake, creds, cli, oc, calls, tmpdir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const readJ = (run) => JSON.parse(fs.readFileSync(path.join(run, 'judgments.json'), 'utf8'));

module.exports = { sandbox, readJ, FAKE_JUDGE, CREDS };
