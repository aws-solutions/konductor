// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap decide`: one call per skill from the arm scores of its study. Pure: scores in, a decision and its evidence out.
//
// Calls: DELETE, PRUNE (sections to remove or move, with file lines), KEEP, or NEEDS DATA. A DELETE or PRUNE call is made
// only when every gate holds: the known-answer controls passed, an A/A arm exists, the scores are on a 0 to 1 scale,
// each side has enough runs, the skill loaded in the control runs, and the result clears mappedVerdict (confidence
// medium or high, units valid; for a harm call the effect clears the A/A spread and enough evidence runs back it).
// Anything else is NEEDS DATA with the reason and the next step. Scores are quality 0 to 1 per run; credits ride along.
//
// Two routes lead to DELETE or a cut. "Harm": removing it improved quality, outside the A/A spread. "No effect":
// removing it stayed within the margin, the interval excludes a larger loss, and the A/A spread is smaller than the
// margin so the study could have seen one. The margin, run counts and the 30% load floor are our own thresholds.

const { diffCI } = require('../report/stats.js');
const { mappedVerdict } = require('../report/skillcard.js');
const { pointerBytes, defaultOpenWhen } = require('./ablate.js');

const MARGIN = 0.1;
const NOISE_FLOOR = 0.05;
const MIN_RUNS = 15;
const HIGH_RUNS = 30;
const LOAD_MIN = 0.3;
const CENSOR_MAX_SHARE = 0.1;
const CENSOR_MAX_GAP = 1;
const LEVELS = ['low', 'medium', 'high'];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (v, d = 4) => (typeof v === 'number' ? Number(v.toFixed(d)) : v);
const finite = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
const lower = (c) => LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];
const minLevel = (a, b) => LEVELS[Math.min(LEVELS.indexOf(a), LEVELS.indexOf(b))];

/** head - base on scores, with a bootstrap interval; ci is null when a side has fewer than two runs. */
function compareArms(head, base) {
  const h = finite(head);
  const b = finite(base);
  if (!h.length || !b.length) return { delta: null, ci: null, nHead: h.length, nBase: b.length };
  const r = diffCI(h, b);
  return { delta: r.delta, ci: h.length < 2 || b.length < 2 ? null : { lo: r.ciLow, hi: r.ciHigh }, nHead: h.length, nBase: b.length };
}

const timeoutCount = (arm) => ({ t: Number(arm?.timeouts) || 0, n: Number(arm?.runs) || finite(arm?.scores ?? []).length });

/**
 * A comparison is censored when a run that hit the time limit can stand in for a finished one: more than 10% of the runs
 * on either side timed out, or the sides differ by more than one timeout (the smaller side's run count scales the gap
 * when the sides are unequal). Scores of cut-off runs come from half-finished work, so no call rests on them.
 * Returns null when the comparison is not censored, else { reason, variant, control }.
 */
function censoring(variant, ctl) {
  const v = timeoutCount(variant);
  const c = timeoutCount(ctl);
  if (!v.t && !c.t) return null;
  const share = (x) => (x.n ? x.t / x.n : 0);
  const gap = Math.abs(share(v) - share(c)) * Math.min(v.n, c.n);
  const why = [];
  if (share(v) > CENSOR_MAX_SHARE) why.push(`${v.t} of ${v.n} runs of the variant timed out`);
  if (share(c) > CENSOR_MAX_SHARE) why.push(`${c.t} of ${c.n} control runs timed out`);
  if (gap > CENSOR_MAX_GAP) why.push(`the timeout counts differ (${v.t} of ${v.n} against ${c.t} of ${c.n})`);
  if (!why.length) return null;
  const tasks = (a) => Object.entries(a?.timeoutTasks ?? {}).map(([k, n]) => `${k} ${n}`).join(', ');
  const where = [tasks(variant) && `variant: ${tasks(variant)}`, tasks(ctl) && `control: ${tasks(ctl)}`].filter(Boolean).join('; ');
  return { reason: `censored by the time limit: ${why.join('; ')}${where ? ` (timeouts by task, ${where})` : ''}; the call needs runs that finish`, variant: v, control: c };
}

/**
 * Where one variant stands against the control of its wave.
 * lost: removal made it worse, outside the noise. gained: removal made it better, outside the noise.
 * safe: within the margin, interval excludes a larger loss, the A/A spread is under the margin and both sides have enough runs.
 * unclear: none of those, with the reason. A censored comparison (see censoring) is unclear whatever the scores say.
 */
function variantStatus(variant, ctl, aaSpread) {
  const c = compareArms(variant.scores, ctl.scores);
  const nEach = Math.min(c.nHead, c.nBase);
  const noise = Math.max(aaSpread, NOISE_FLOOR);
  const out = { ...c, aaSpread, nEach, status: 'unclear', reason: '', control: finite(ctl.scores).length ? mean(finite(ctl.scores)) : null, variant: finite(variant.scores).length ? mean(finite(variant.scores)) : null };
  const cr = finite(variant.credits ?? []);
  const cc = finite(ctl.credits ?? []);
  out.credits = cr.length && cc.length ? { delta: round(mean(cr) - mean(cc)), unit: 'credits', variant: round(mean(cr)), control: round(mean(cc)) } : { delta: null, unit: 'credits' };
  out.timeouts = { variant: timeoutCount(variant), control: timeoutCount(ctl) };
  const cens = censoring(variant, ctl);
  if (cens) { out.reason = cens.reason; out.censored = true; return out; }
  if (nEach < MIN_RUNS) { out.reason = `${nEach} run${nEach === 1 ? '' : 's'} on the smaller side, fewer than ${MIN_RUNS} needed`; return out; }
  if (!c.ci) { out.reason = 'no interval'; return out; }
  if (c.ci.hi < 0 && -c.delta > noise) { out.status = 'lost'; return out; }
  if (c.ci.lo > 0 && c.delta > noise) { out.status = 'gained'; return out; }
  if (aaSpread > MARGIN) { out.reason = `the A/A spread ${round(aaSpread, 3)} is wider than the ${MARGIN} margin, so a no-effect result cannot be read`; return out; }
  if (c.ci.lo >= -MARGIN) { out.status = 'safe'; return out; }
  out.reason = `the interval reaches ${round(c.ci.lo, 3)}, past the ${MARGIN} margin`;
  return out;
}

const confidenceOf = (s) => {
  if (s.nEach < MIN_RUNS) return 'low';
  if (s.nEach >= HIGH_RUNS && (s.status !== 'safe' || (s.ci && s.ci.hi - s.ci.lo <= MARGIN))) return 'high';
  return 'medium';
};

const fmtCi = (s) => (s.ci ? `${round(s.delta, 3)} (95% interval ${round(s.ci.lo, 3)} to ${round(s.ci.hi, 3)})` : `${round(s.delta, 3)}`);
const pts = (v) => `${Math.abs(round(v * 100, 1))} points`;

function armOf(wave, id) { return wave?.arms?.[id] ?? null; }
function waveOf(waves, n) { return waves.find((w) => w.wave === n) ?? null; }

function unitsOk(waves) {
  for (const w of waves) for (const a of Object.values(w.arms)) if (finite(a.scores).some((x) => x < 0 || x > 1)) return false;
  return true;
}

/**
 * skill: { id, name, estTokens, sections:[{id,title,level,startLine,endLine,kind,bytes,estTokens}] }.
 * controls: { trusted: true|false|null }. waves: [{ wave, arms: { ctl, 'ctl-b', del | rm<k> | mv<k>: { scores, credits, loaded } }, opened }].
 */
function decideSkill({ skill, controls, waves }) {
  const sections = skill.sections ?? [];
  const base = { skill: skill.id, name: skill.name, estTokens: skill.estTokens ?? null, evidence: { del: null, sections: {} }, sections: [], tokensSaved: 0, reasons: [], next: [], missing: [], aaSpread: null };
  const needs = (reason, next) => ({ ...base, decision: 'NEEDS DATA', confidence: 'low', verdict: 'incomplete', reasons: [reason], next: next ? [next] : [], sections: sections.map((s) => untested(s)) });
  const untested = (s) => ({ ...secInfo(s), action: 'untested', note: '' });

  if (controls?.trusted !== true) return needs(controls?.trusted === false ? 'the known-answer controls did not pass, so no skill verdict from this study can be trusted' : 'the known-answer controls were not run or not checked (cap controls), so no verdict is made', 'run the controls and cap controls --check, then decide again');
  const w1 = waveOf(waves, 1);
  const ctl = armOf(w1, 'ctl');
  const aa = armOf(w1, 'ctl-b');
  const del = armOf(w1, 'del');
  if (!ctl || !del) return needs('wave 1 (control and delete variant) has not finished', 'finish wave 1');
  if (!unitsOk(waves)) return needs('scores outside 0 to 1: the units are wrong, so the numbers are not used', 'check the scoring input (quality should be 0 to 1)');
  if (!aa) return needs('no A/A arm (ctl-b) in wave 1, so there is no noise floor', 'rerun wave 1 with the A/A arm');

  const aaCmp = compareArms(aa.scores, ctl.scores);
  const aaSpread = aaCmp.delta === null ? 0 : Math.abs(aaCmp.delta);
  base.aaSpread = round(aaSpread, 4);
  const loadedN = (ctl.loaded ?? []).filter(Boolean).length;
  const loadedOf = (ctl.loaded ?? []).length;
  base.evidence.ctlLoad = { loaded: loadedN, of: loadedOf, rate: loadedOf ? loadedN / loadedOf : null };
  if (!loadedOf || loadedN / loadedOf < LOAD_MIN) {
    const none = loadedN === 0 ? ' (never loaded: no information about this skill)' : '';
    return { ...needs(`the skill loaded in ${loadedN} of ${loadedOf} control runs, under ${Math.round(LOAD_MIN * 100)}%${none}: a study cannot show lift or harm for a skill the agent does not load`, 'check discovery (cap trigger, routing text, description) or pick tasks that need the skill'), evidence: base.evidence, aaSpread: base.aaSpread };
  }

  const dv = variantStatus(del, ctl, aaSpread);
  base.evidence.del = dv;
  const gate = (cls, confidence, n, insideNoise) => mappedVerdict({ cls, provisional: false, exposed: loadedOf, confidence, evidenceN: n, insideNoise, unitMismatch: false });

  if (dv.status === 'unclear') {
    return { ...needs(`the delete variant is unclear: ${dv.reason}`, 'more replicates or tasks, or a quieter A/A pair'), evidence: base.evidence, aaSpread: base.aaSpread };
  }
  const nRuns = dv.nHead + dv.nBase;
  const conf = confidenceOf(dv);
  if (dv.status === 'gained' || dv.status === 'safe') {
    const harm = dv.status === 'gained';
    const verdict = gate(harm ? 'HARMS' : 'PRUNE', conf, nRuns, harm ? false : null);
    const why = harm
      ? `removing the skill improved quality by ${pts(dv.delta)}, ${fmtCi(dv)}, outside the A/A spread ${round(aaSpread, 3)}`
      : `removing the skill lost no more than the ${pts(MARGIN)} margin: ${fmtCi(dv)} on ${dv.nHead} and ${dv.nBase} runs, A/A spread ${round(aaSpread, 3)}, the skill loaded in ${Math.round((loadedN / loadedOf) * 100)}% of control runs`;
    if (verdict !== 'prune candidate') {
      return { ...needs(`would be DELETE (${why}) but confidence is ${conf}, so it goes to a person`, 'more replicates'), evidence: base.evidence, aaSpread: base.aaSpread, verdict };
    }
    return { ...base, decision: 'DELETE', confidence: conf, verdict, reasons: [why], tokensSaved: skill.estTokens ?? 0, next: ['review the patch; remove the skill from every agent list, the claudeCli list and any inbound reference'], sections: sections.map((s) => untested(s)) };
  }

  // Removing the skill lost quality: the skill is needed. Look at the sections.
  const need = `removing the skill lost ${pts(-dv.delta)}, ${fmtCi(dv)}, outside the A/A spread ${round(aaSpread, 3)}`;
  const w2 = waveOf(waves, 2);
  const w3 = waveOf(waves, 3);
  const results = sections.map((s, i) => sectionResult(s, i + 1, { w2, w3, aaSpread }));
  for (const r of results) base.evidence.sections[r.id] = r.evidence;
  const tested = results.some((r) => r.action !== 'untested');
  const cuts = results.filter((r) => r.action === 'remove' || r.action === 'move');

  if (!sections.length || !w2) {
    const keepV = gate('KEEP', conf, nRuns, false);
    const missing = sections.length && !w2 ? ['wave 2 (section removals) has not run'] : [];
    return { ...base, decision: 'KEEP', confidence: conf, verdict: keepV, reasons: [need], missing, next: missing.length ? ['run wave 2 to find sections that can go'] : [], sections: results };
  }
  if (!cuts.length) {
    const keepV = gate('KEEP', conf, nRuns, false);
    return { ...base, decision: 'KEEP', confidence: conf, verdict: keepV, reasons: [need, tested ? 'no tested section could be removed or moved without losing quality' : 'no section was tested'], sections: results, missing: w3 ? [] : ['wave 3 (moves) has not run for sections whose removal lost quality'] };
  }
  let cutConf = cuts.reduce((c, r) => minLevel(c, r.confidence), 'high');
  const notes = [];
  if (cuts.length > 1) { cutConf = minLevel(cutConf, 'medium'); notes.push('the sections were tested one at a time; the combined cut is not tested'); }
  const verdict = gate('PRUNE', cutConf, cuts.reduce((n, r) => n + r.evidence.nHead + r.evidence.nBase, 0), null);
  const saved = cuts.reduce((n, r) => n + r.tokensSaved, 0);
  const lines = cuts.map((r) => `${r.action} ${r.title} (lines ${r.startLine}-${r.endLine}, about ${r.tokensSaved} tokens)`);
  if (verdict !== 'prune candidate') {
    return { ...needs(`would be PRUNE (${lines.join('; ')}) but confidence is ${cutConf}, so it goes to a person`, 'more replicates on the cut sections'), evidence: base.evidence, sections: results, verdict, aaSpread: base.aaSpread };
  }
  return {
    ...base, decision: 'PRUNE', confidence: cutConf, verdict, reasons: [need, ...lines, ...notes], tokensSaved: saved, sections: results,
    next: [...(cuts.length > 1 ? ['run the combined cut as one arm against ctl before merging (combined)'] : []), 'review the patch'],
  };

  function secInfo(s) {
    return { id: s.id, title: s.title, startLine: s.startLine, endLine: s.endLine, bytes: s.bytes, estTokens: s.estTokens, kind: s.kind };
  }

  function sectionResult(s, k, { w2: wave2, w3: wave3, aaSpread: aa2 }) {
    const info = secInfo(s);
    const ctl2 = armOf(wave2, 'ctl');
    const rmArm = armOf(wave2, `rm${k}`);
    const ctl3 = armOf(wave3, 'ctl');
    const mvArm = armOf(wave3, `mv${k}`);
    const aaFor = (w) => { const a = armOf(w, 'ctl-b'); const c = armOf(w, 'ctl'); if (!a || !c) return aa2; const x = compareArms(a.scores, c.scores); return x.delta === null ? aa2 : Math.abs(x.delta); };
    const rm = rmArm && ctl2 ? variantStatus(rmArm, ctl2, aaFor(wave2)) : null;
    const mv = mvArm && ctl3 ? variantStatus(mvArm, ctl3, aaFor(wave3)) : null;
    const opened = wave3?.opened && Object.hasOwn(wave3.opened, `mv${k}`) ? wave3.opened[`mv${k}`] : null;
    const ev = { rm, mv, opened, nHead: (rm ?? mv)?.nHead ?? 0, nBase: (rm ?? mv)?.nBase ?? 0 };
    const out = { ...info, action: 'untested', note: '', confidence: 'low', tokensSaved: 0, evidence: ev };
    const ok = (x) => x && (x.status === 'safe' || x.status === 'gained');
    if (ok(rm)) { out.action = 'remove'; out.confidence = confidenceOf(rm); out.tokensSaved = s.estTokens; out.evidence = { ...ev, nHead: rm.nHead, nBase: rm.nBase }; }
    else if (ok(mv)) {
      const openWhen = defaultOpenWhen({ title: s.title, kind: s.kind });
      const pointerTokens = Math.round(pointerBytes(s, { openWhen }) / 4);
      out.action = 'move'; out.openWhen = openWhen; out.pointerTokens = pointerTokens; out.confidence = confidenceOf(mv); out.tokensSaved = Math.max(0, s.estTokens - pointerTokens);
      out.evidence = { ...ev, nHead: mv.nHead, nBase: mv.nBase };
      if (opened === 0) out.note = 'the reference file was never opened in the move arm, so the move behaves like a removal there; check a removal before relying on it';
    } else if (rm || mv) {
      out.action = 'keep';
      const lostSide = [rm, mv].find((x) => x?.status === 'lost');
      out.note = lostSide ? `${rm?.status === 'lost' ? 'removal' : 'move'} lost quality (${fmtCi(lostSide)})` : `unclear: ${(rm ?? mv).reason}`;
    }
    return out;
  }
}

const STATUS_VERDICT = { lost: 'helps', gained: 'hurts', safe: 'none', unclear: 'unmeasurable' };

/** Evidence-file rows (the format of --evidence for cap prune-report) for every tested variant. delta is with minus without. */
function evidenceRowsFor(decision, { runId = null } = {}) {
  const rows = [];
  const add = (st, label) => {
    if (!st || st.delta === null || st.control === null) return;
    rows.push({
      capId: decision.skill, harness: 'kiro-cli', kind: 'ablation', task: `pooled:${label}`, n: st.nHead + st.nBase,
      delta: round(st.control - st.variant), aaSpread: round(st.aaSpread ?? decision.aaSpread ?? 0), verdict: STATUS_VERDICT[st.status], runId,
      note: `${label}; ${st.status}${st.reason ? ` (${st.reason})` : ''}`, withValue: round(st.control), withoutValue: round(st.variant),
    });
  };
  add(decision.evidence.del, 'delete variant');
  for (const s of decision.sections) {
    add(s.evidence?.rm, `remove ${s.id} (lines ${s.startLine}-${s.endLine})`);
    add(s.evidence?.mv, `move ${s.id} to references (lines ${s.startLine}-${s.endLine})`);
  }
  return rows;
}

// ---- report ----

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const ORDER = ['DELETE', 'PRUNE', 'KEEP', 'NEEDS DATA'];

/** The decision report in markdown: a summary table, then per-skill sections with file ranges, evidence and patch paths. */
function renderDecisions(decisions, meta = {}) {
  const L = ['# Per-skill decisions', ''];
  L.push(`Base ${meta.base ?? '-'}; created ${meta.createdAt ?? '-'}; known-answer controls ${meta.controls?.trusted === true ? 'passed' : meta.controls?.trusted === false ? 'FAILED' : 'not checked'}.`, '');
  L.push('A call is a recommendation for a person to review, never a change. DELETE and PRUNE need medium or high confidence, passed controls, an A/A arm, scores on a 0 to 1 scale, enough runs per side and a skill the agent actually loaded; anything weaker is NEEDS DATA with the reason. Thresholds (the margin, the run counts, the 30% load floor) are our own.', '');
  const counts = Object.fromEntries(ORDER.map((k) => [k, decisions.filter((d) => d.decision === k).length]));
  L.push('## Summary', '', table(['call', 'skills'], ORDER.map((k) => [k, counts[k]])), '');
  const sorted = [...decisions].sort((a, b) => ORDER.indexOf(a.decision) - ORDER.indexOf(b.decision) || (a.tier ?? '').localeCompare(b.tier ?? '') || a.name.localeCompare(b.name));
  L.push(table(['skill', 'tier', 'call', 'confidence', 'tokens saved', 'why'], sorted.map((d) => [d.name, d.tier ?? '-', d.decision, d.confidence, d.tokensSaved || '-', (d.reasons ?? []).join('; ')])), '');
  for (const d of sorted.filter((x) => x.decision !== 'NEEDS DATA' || x.waves?.length)) {
    L.push(`## ${d.name}: ${d.decision} (${d.confidence})`, '');
    for (const r of d.reasons ?? []) L.push(`- ${r}`);
    for (const m of d.missing ?? []) L.push(`- missing: ${m}`);
    const ev = d.evidence?.del;
    if (ev) L.push(`- delete variant: ${ev.status}, delta ${round(ev.delta, 3)}${ev.ci ? ` (95% interval ${round(ev.ci.lo, 3)} to ${round(ev.ci.hi, 3)})` : ''}, ${ev.nHead} vs ${ev.nBase} runs, A/A spread ${round(ev.aaSpread, 3)}${ev.credits?.delta !== null && ev.credits?.delta !== undefined ? `, credits per run ${ev.credits.delta >= 0 ? '+' : ''}${ev.credits.delta}` : ''}`);
    const to = ev?.timeouts;
    if (to && (to.variant.t || to.control.t)) L.push(`- timeouts: ${to.variant.t} of ${to.variant.n} variant runs, ${to.control.t} of ${to.control.n} control runs`);
    if (d.evidence?.ctlLoad) L.push(`- the skill loaded in ${d.evidence.ctlLoad.loaded} of ${d.evidence.ctlLoad.of} control runs`);
    const secs = (d.sections ?? []).filter((s) => s.action !== 'untested' || d.decision === 'KEEP');
    if (secs.length && d.sections.some((s) => s.action !== 'untested')) {
      L.push('', table(['section', 'file:lines', 'action', 'tokens saved', 'evidence'], d.sections.map((s) => [s.title, `skills/${d.name}/SKILL.md:${s.startLine}-${s.endLine}`, s.action === 'move' ? `move to references/${s.id}.md, open when ${s.openWhen}` : s.action, s.tokensSaved || '-',
        [s.evidence?.rm && `remove ${s.evidence.rm.status} ${round(s.evidence.rm.delta, 3)}`, s.evidence?.mv && `move ${s.evidence.mv.status} ${round(s.evidence.mv.delta, 3)}`, s.evidence?.opened != null && `opened in ${s.evidence.opened} runs`, s.note].filter(Boolean).join('; ')])));
    }
    if (d.patch) L.push('', `Patch (not applied): ${d.patch.file} (${d.patch.files.join(', ')})`);
    if (d.patchError) L.push('', `Patch could not be built: ${d.patchError}`);
    for (const n of d.next ?? []) L.push(`- next: ${n}`);
    L.push('');
  }
  L.push('## Not shown by this study', '', '- Skills in the triage tier have no lift run; their row is the free audit and load data only.', '- A moved section can go unopened; the move arm records how many runs opened the file, and an unopened move is flagged.', '- Sections were tested one at a time. A combined cut is confirmed by one more arm against the control before merging.', '- Quality is the bench score on the study tasks; a skill can matter on tasks that were not in the study.', '');
  return L.join('\n');
}

module.exports = { compareArms, variantStatus, censoring, CENSOR_MAX_SHARE, CENSOR_MAX_GAP, decideSkill, evidenceRowsFor, renderDecisions, MARGIN, NOISE_FLOOR, MIN_RUNS, HIGH_RUNS, LOAD_MIN };
