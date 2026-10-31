// SPDX-License-Identifier: Apache-2.0
'use strict';

// One decision card per skill and harness, built from a prune report. It puts side by side what a decision needs:
// whether the agent can reach the skill, how often it loads it (invocation rate, with an interval), what it costs
// (bytes, tokens), what controlled runs showed (paired lift, normalized gain, the A/A noise check) and what is
// still missing. The metrics follow the usual skill-ablation vocabulary: invocation rate, paired lift and Hake
// normalized gain from SkillsBench, with versus baseline pass rates from skill-creator, and keep, prune candidate,
// needs human review and incomplete as the decision-board verdicts. The mapping from this tool's classes to those
// verdicts is ours; no gap threshold from another scale is copied.

const { wilson } = require('./stats.js');

const VERDICTS = ['keep', 'prune candidate', 'needs human review', 'incomplete'];
const MIN_EVIDENCE_N = 6;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** (with - without) / (1 - without). Null when either is missing or the baseline is already at 1. */
function hakeGain(withV, withoutV) {
  if (!finite(withV) || !finite(withoutV) || withoutV >= 1) return null;
  return (withV - withoutV) / (1 - withoutV);
}

function mappedVerdict({ cls, provisional, exposed }) {
  if (cls === 'KEEP') return provisional ? 'needs human review' : 'keep';
  if (cls === 'PRUNE' || cls === 'HARMS') return 'prune candidate';
  if (cls === 'NEEDS DATA' && exposed < 10) return 'incomplete';
  return 'needs human review';
}

function evidenceRow(r) {
  const lift = finite(r.withValue) && finite(r.withoutValue) ? (r.withValue - r.withoutValue) * 100 : null;
  const known = finite(r.delta) && finite(r.aaSpread);
  return {
    kind: r.kind, task: r.task, n: r.n, delta: r.delta, aaSpread: r.aaSpread, verdict: r.verdict, runId: r.runId, note: r.note,
    withValue: r.withValue ?? null, withoutValue: r.withoutValue ?? null, liftPoints: lift, gain: hakeGain(r.withValue, r.withoutValue),
    negative: (finite(lift) ? lift : r.delta) < 0, insideNoise: known ? Math.abs(r.delta) <= r.aaSpread : null,
    atCeiling: finite(r.withoutValue) && r.withoutValue >= 0.95,
  };
}

function checksFor(c, minExposure) {
  const yn = (b) => (b ? 'YES' : 'NO');
  const ev = c.evidence;
  const decisive = ev.filter((e) => ['helps', 'hurts'].includes(e.verdict));
  const noise = !ev.length ? ['n/a', 'no controlled run on file']
    : decisive.length && decisive.every((e) => e.insideNoise === false) ? ['YES', 'every helps or hurts row clears its A/A spread']
      : decisive.some((e) => e.insideNoise === true) ? ['NO', 'a helps or hurts row sits inside the A/A spread']
        : ev.every((e) => e.insideNoise !== null) ? ['YES', 'no A/A spread contradicts a row'] : ['NO', 'an A/A spread is missing on some rows'];
  const n = ev.reduce((a, e) => a + (e.n || 0), 0);
  return [
    { id: 'reach', label: 'An agent on this harness can reach it', status: yn(c.reachable), detail: c.reachable ? (c.agents?.length ? `listed by ${c.agents.join(', ')}` : 'reachable') : 'no agent lists it' },
    { id: 'exposure', label: `Offered in at least ${minExposure} runs`, status: yn(c.exposed >= minExposure), detail: `${c.exposed} exposed run(s)${c.coarse ? `, ${c.coarse} coarse` : ''}` },
    { id: 'rate', label: 'Load rate measured', status: yn(c.rate !== null), detail: c.rate === null ? 'never offered' : `${c.runsLoaded} of ${c.exposed}` },
    { id: 'evidence', label: 'A controlled with-versus-without result is on file', status: yn(ev.length > 0), detail: `${ev.length} row(s)` },
    { id: 'noise', label: 'The effect clears the A/A noise', status: noise[0], detail: noise[1] },
    { id: 'sample', label: `Evidence covers at least ${MIN_EVIDENCE_N} runs`, status: ev.length ? yn(n >= MIN_EVIDENCE_N) : 'n/a', detail: ev.length ? `n=${n}` : 'no evidence' },
    { id: 'refs', label: 'Nothing else references it (safe to remove)', status: yn(c.inboundRefs === 0), detail: `${c.inboundRefs} inbound reference(s)` },
  ];
}

/** One card per skill and assessed harness. report: the prune report object. */
function buildSkillCards(report) {
  const out = [];
  for (const cap of report.capabilities) {
    for (const h of report.harnesses) {
      const v = cap.harnesses[h];
      if (!v) continue;
      const exposed = v.exposure.runs;
      const w = exposed > 0 ? wilson(v.loads.runsLoaded, exposed) : null;
      const k = v.classification;
      const card = {
        id: cap.id, name: cap.name, harness: h, cls: k.class, provisional: k.provisional, confidence: k.confidence, reason: k.reason, wouldChange: k.wouldChange,
        reachable: v.reachable, agents: v.agents ?? [], exposed, coarse: v.exposure.coarse || 0, runsLoaded: v.loads.runsLoaded, loads: v.loads.total,
        rate: exposed > 0 ? v.loads.runsLoaded / exposed : null, lo: w ? w.lo : null, hi: w ? w.hi : null,
        bytes: cap.bytes, estTokens: cap.estTokens, meanBytesPerLoad: v.loads.meanBytesPerLoad, trim: cap.trim, linkedTasks: cap.linkedTasks || [], inboundRefs: cap.inboundRefs || 0,
        evidence: (v.evidence || []).map(evidenceRow),
      };
      card.verdict = mappedVerdict({ cls: card.cls, provisional: card.provisional, exposed });
      card.checks = checksFor(card, report.minExposure);
      out.push(card);
    }
  }
  return out;
}

module.exports = { buildSkillCards, hakeGain, mappedVerdict, VERDICTS, MIN_EVIDENCE_N };
