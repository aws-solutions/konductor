// SPDX-License-Identifier: Apache-2.0
'use strict';

// A stand-in for bench.js used by the pilot-2x2.sh tests. It records each call as a line of JSON in
// $PILOT_FAKE_LOG and writes the files the script reads back (summary.json, result.json, judgments.json). It never
// contacts anything. $PILOT_FAKE_MODE holds space-separated switches:
//   fail:<cell-arm>:<task>   exit 1 before writing anything         partial:<arm>:<task>  write an interrupted summary, exit 1
//   sleep:<ms>               wait before finishing                   cost:<n>              cost of one run (USD or credits)
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const modes = (process.env.PILOT_FAKE_MODE || '').split(/\s+/).filter(Boolean);
const modeVal = (key) => (modes.find((m) => m.startsWith(`${key}:`)) || '').slice(key.length + 1);

const credsFile = flag('aws-creds-file');
const call = {
  cmd: args[0], args, tmpdir: process.env.TMPDIR, home: process.env.HOME,
  awsKeysInEnv: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'].filter((k) => process.env[k]),
  profileVarsInEnv: ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE'].filter((k) => process.env[k]),
  credsFile: credsFile ? { exists: fs.existsSync(credsFile), mode: fs.existsSync(credsFile) ? (fs.statSync(credsFile).mode & 0o777).toString(8) : null, hasKeyId: fs.existsSync(credsFile) && /aws_access_key_id = \S+/.test(fs.readFileSync(credsFile, 'utf8')) } : null,
};
fs.appendFileSync(process.env.PILOT_FAKE_LOG, `${JSON.stringify(call)}\n`);
const sleep = Number(modeVal('sleep'));
const done = () => {
  const cmd = args[0];
  if (cmd === 'run') {
    const out = flag('out');
    const arm = flag('arms').split('=')[0];
    const task = flag('tasks');
    const reps = Number(flag('replicates') || 1);
    if (modes.includes(`fail:${arm}:${task}`)) process.exit(1);
    const isCc = arm.startsWith('cc-');
    const cost = Number(modeVal('cost') || (isCc ? 0.1 : 2));
    const results = [];
    for (let rep = 1; rep <= reps; rep++) {
      const r = { armId: arm, taskId: task, replicate: rep, status: 'success', ...(isCc ? { costUsd: cost, costUsdCharged: cost, costCensored: false } : { credits: cost, creditsCharged: cost }) };
      results.push(r);
      const dir = path.join(out, arm, task, String(rep));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(r));
    }
    const partial = modes.includes(`partial:${arm}:${task}`);
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ results, isolationGate: { ok: true }, ...(partial ? { interrupted: 'SIGTERM' } : {}), ...(isCc ? { totalCostUsdCharged: cost * reps } : { totalCreditsCharged: cost * reps }) }));
    process.exit(partial ? 1 : 0);
  }
  if (cmd === 'judge') {
    const run = flag('run');
    const judges = flag('judges').split(',');
    const rubric = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else if (e.name === 'result.json') { const r = JSON.parse(fs.readFileSync(path.join(d, e.name), 'utf8')); for (const judge of judges) rubric.push({ kind: 'rubric', judge, armId: r.armId, taskId: r.taskId, replicate: r.replicate, score: 0.5 }); } } };
    walk(run);
    fs.writeFileSync(path.join(run, 'judgments.json'), JSON.stringify({ judges, rubric, spentUsd: 0.05 }));
    process.exit(0);
  }
  if (cmd === 'report-2x2') {
    const out = flag('out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'factorial-2x2.md'), '# fake table\n');
    console.log('# fake table');
    process.exit(0);
  }
  process.exit(3);
};
if (sleep > 0) setTimeout(done, sleep); else done();
