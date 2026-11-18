// SPDX-License-Identifier: Apache-2.0
'use strict';

// SR-24 in bench judge and its reports: a run's score is the median of three or more judges from distinct families
// other than the agent's, and NO DATA with fewer. Every judge's own score stays visible.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, writeJudgments } = require('./helpers.js');
const { panelScore, MIN_JUDGES } = require('../../judge/score.js');
const { resolveJudges } = require('../eval-commands.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

test('panelScore is the median of three or more scores and NO DATA (null) with fewer', () => {
  assert.equal(MIN_JUDGES, 3);
  assert.equal(panelScore([0.2, 1, 0.9]), 0.9);
  assert.equal(panelScore([0, 0.5, 1, 1]), 0.75);
  assert.equal(panelScore([1, 0.4]), null);
  assert.equal(panelScore([1, null, 0.4, NaN]), null);
  assert.equal(panelScore([]), null);
});

test('the report scores each run by the median of its judges, shows every judge, and flags NO DATA runs', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }, { arm: 'vanilla', rep: 2 }]);
    writeJudgments(runDir, {
      judges: ['ja', 'jb', 'jc'],
      rubric: [
        { judge: 'ja', arm: 'vanilla', rep: 1, score: 0.2 }, { judge: 'jb', arm: 'vanilla', rep: 1, score: 1 }, { judge: 'jc', arm: 'vanilla', rep: 1, score: 0.9 },
        { judge: 'ja', arm: 'vanilla', rep: 2, score: 0.5 }, { judge: 'jb', arm: 'vanilla', rep: 2, score: 0.5 },
      ],
    });
    const { report } = buildReport({ run: loadRun(runDir), tasks: loadTasks(bench), baseline: 'vanilla' });
    const r = report.arms.vanilla.overall.rubric;
    // run 1: median 0.9 (the mean would be 0.7); run 2 has two judges, so NO DATA and left out.
    assert.deepEqual([r.medianOfJudges.n, r.medianOfJudges.mean, r.medianOfJudges.noData], [1, 0.9, 1]);
    assert.deepEqual(Object.keys(r.byJudge), ['ja', 'jb', 'jc']);
    const md = renderMarkdown(report);
    assert.match(md, /ja 0\.35 \(raw [^)]*\)<br>jb 0\.75 \(raw [^)]*\)<br>jc 0\.90 \(raw [^)]*\)<br>median of judges 0\.90 \(raw [^)]*\), NO DATA 1 \(under 3 judges\)/);
    assert.match(md, /1 run\(s\) have rubric scores from fewer than 3 judges: NO DATA/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('judge refuses a panel with fewer than three eligible families: unknown families do not count, nor does the agent\'s', () => {
  assert.throws(() => resolveJudges({ cliJudges: 'foo-1,bar-2,baz-3' }), /0 eligible model family\(ies\).*foo-1: its model family is unknown/);
  assert.throws(() => resolveJudges({ cliJudges: 'gpt-5.6-luna,deepseek-3.2,mystery-7', subjectModel: 'claude-sonnet-5.5' }), /2 eligible .*mystery-7: its model family is unknown.*--allow-small-panel \(every score is then NO DATA\)/);
  assert.deepEqual(resolveJudges({ cliJudges: 'gpt-5.6-luna,deepseek-3.2,glm-5', subjectModel: 'claude-sonnet-5.5' }).small, false);
  assert.equal(resolveJudges({ cliJudges: 'foo-1,bar-2,baz-3', allowSmallPanel: true }).small, true);
});
