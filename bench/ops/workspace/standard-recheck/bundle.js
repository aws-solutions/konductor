// Builds one recheck work dir holding several tasks (round 6; probe tasks and bench/fixtures supported).
//   node bundle.js <outdir> <id> [id ...]
// Per task: tasks/<id>/{task.json (no review, pilot, handEdited, authorship), fixture/, hidden/ (shared helpers
// folded back in), solution/, edits.md (the HAND-EDITS.md lines and section heads that name the task)}.
const fs = require('node:fs');
const path = require('node:path');
const REPO = process.env.BENCH_REPO;
const SC = path.join(REPO, 'bench/scenarios');
const LIB = path.join(SC, 'lib/hidden');
const { ANSWER_KEY } = require(path.join(REPO, 'bench/runner/lib/check-matcher.js'));
const [out, ...ids] = process.argv.slice(2);
fs.mkdirSync(path.join(out, 'tasks'), { recursive: true });

function editsFor(batchDir, id) {
  const lines = fs.readFileSync(path.join(batchDir, 'HAND-EDITS.md'), 'utf8').split('\n');
  const keep = [];
  let head = '', sub = '', subHit = false, para = [], paraHead = '';
  const flush = () => { if (para.some((l) => l.includes(id))) keep.push('', paraHead, ...para); para = []; };
  for (const l of lines) {
    if (/^## /.test(l)) { flush(); head = l; sub = ''; subHit = false; continue; }
    if (/^### /.test(l)) { flush(); sub = l; subHit = l.includes(id); if (subHit) keep.push('', head, l); continue; }
    if (subHit && l.trim()) { keep.push(l); continue; }
    if (/^\|/.test(l)) { flush(); if (l.includes(id)) keep.push('', head, sub, l); continue; }
    if (!l.trim()) { flush(); continue; }
    if (!para.length) paraHead = [head, sub].filter(Boolean).join('\n');
    para.push(l);
  }
  flush();
  return keep.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}

for (const id of ids) {
  const batch = id.split('-')[0];
  const bd = path.join(SC, batch);
  const task = JSON.parse(fs.readFileSync(path.join(bd, `${id}.json`), 'utf8'));
  const dst = path.join(out, 'tasks', id);
  fs.mkdirSync(dst, { recursive: true });
  const { review, pilot, handEdited, authorship, ...shown } = task;
  fs.writeFileSync(path.join(dst, 'task.json'), `${JSON.stringify(shown, null, 2)}\n`);
  const cp = (a, b, filter) => { if (fs.existsSync(a)) { fs.cpSync(a, b, { recursive: true, filter }); return true; } return false; };
  // The fixture is copied the way sandbox.copyFixture copies it for the agent: without the grader's answer key.
  const agentSees = (p) => path.basename(p) !== ANSWER_KEY;
  const fx = task.fixture || id;
  if (!cp(path.join(bd, 'fixtures', fx), path.join(dst, 'fixture'), agentSees) && !cp(path.join(REPO, 'bench/fixtures', fx), path.join(dst, 'fixture'), agentSees)) {
    throw new Error(`${id}: no fixture ${fx}`);
  }
  cp(path.join(bd, 'hidden', task.hidden || id), path.join(dst, 'hidden'));
  const man = path.join(dst, 'hidden', '.bench-lib.json');
  if (fs.existsSync(man)) {
    for (const [rel, name] of Object.entries(JSON.parse(fs.readFileSync(man, 'utf8')))) {
      const to = path.join(dst, 'hidden', rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // "@pristine" is the untouched fixture (bench/runner/lib/hidden-lib.js); the bundle already holds it in fixture/.
      if (name === '@pristine') { fs.writeFileSync(to, 'the untouched fixture: see ../fixture/\n'); continue; }
      fs.copyFileSync(path.join(LIB, name), to);
    }
  }
  cp(path.join(bd, 'solutions', id), path.join(dst, 'solution'));
  fs.writeFileSync(path.join(dst, 'edits.md'), editsFor(bd, id));
}
console.log(`${ids.length} tasks in ${out}`);
