// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap prune-report`: one recommendation per skill and harness, from the static audit, the loads recomputed from finished
// runs, and an optional evidence file. Read-only; no model, no credits. A class is a recommendation, never a deletion.

const { runAudit } = require('./audit.js');
const { scanRunDirs, tallyUsage } = require('./usage.js');
const { MIN_EVIDENCE_N } = require('../report/skillcard.js');

const TOOL_VERSION = 'cap-prune-report/1';
const LOAD_RATE_MIN = 0.3;
const NEAR_DUPLICATE_MIN = 0.6;
const CLASSES = ['HARMS', 'RELOCATE', 'PRUNE', 'FIX', 'KEEP', 'NEEDS DATA'];
const CLAUDE_TEXT = /\bclaude[ -]?code\b|\bclaudeCli\b/i;
const estTokens = (bytes) => Math.round(bytes / 4);
const LEVELS = ['low', 'medium', 'high'];
const DEFAULT_MIN_EXPOSURE = 10;
const MIN_EXPOSURE_FLOOR = 3;
const MEDIUM_MIN_EXPOSED = 5;
const HIGH_MIN_EXPOSED = 30;

// Printed in the text and document reports so none of these cut-offs reads as borrowed from a published method.
const OWN_THRESHOLDS_NOTE = 'Thresholds that are our own, not from an external source: load rate 30%, near-duplicate Jaccard 0.6, size over the p90 of skill bytes, minimum exposure 10 runs (default, never under 3), confidence medium from 5 exposed runs and high from 30, evidence of at least 6 runs for HARMS, the A/A rule (a delta inside the spread is noise), the 0.95 ceiling, the 600 and 60 character description limits, the 5% leakage limit, and the mapping from classes to keep, prune candidate, needs human review and incomplete.';
const LOAD_RATE_NOTE = 'Load rate is runs that loaded the skill through a skill tool call, divided by runs where an agent could. It is not comparable to SkillsBench\'s skill invocation rate, which counts task-matched trials where the agent reads or invokes a bundled skill. A direct read of a SKILL.md is not counted as a load here.';

/** Nearest-rank 90th percentile. */
function percentile90(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.ceil((sorted.length * 9) / 10) - 1];
}

/** TRIM flag: bytes strictly above the p90 value, or a same-kind neighbour scoring strictly above 0.6. */
function trimFor(rec, p90, bytesOf) {
  const reasons = [];
  if (rec.bytes > p90) reasons.push({ type: 'size', bytes: rec.bytes, estTokens: estTokens(rec.bytes), p90 });
  const near = (rec.neighbours ?? [])[0];
  if (near && near.score > NEAR_DUPLICATE_MIN) reasons.push({ type: 'near-duplicate', neighbour: near.id, score: near.score, bytes: rec.bytes, neighbourBytes: bytesOf(near.id) });
  return { flag: reasons.length > 0, reasons };
}

function summarizeEvidence(rows) {
  const has = (v) => rows.some((r) => r.verdict === v);
  const hurtsN = rows.filter((r) => r.verdict === 'hurts').reduce((a, r) => a + r.n, 0);
  const n = rows.reduce((a, r) => a + r.n, 0);
  const inside = rows.some((r) => ['helps', 'hurts'].includes(r.verdict) && r.delta !== null && r.aaSpread !== null && Math.abs(r.delta) <= r.aaSpread);
  return { hurts: has('hurts'), hurtsN, helps: has('helps'), behaviorChange: rows.some((r) => r.behaviorChange), n, inside };
}

const evidenceConfidence = (ev) => (ev.inside || ev.n < 6 ? 'low' : ev.n >= 10 ? 'high' : 'medium');
const lower = (level) => LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)];
function exposureConfidence(exposed, min, uncertain) {
  const level = exposed >= Math.max(3 * min, HIGH_MIN_EXPOSED) ? 'high' : exposed >= Math.max(min, MEDIUM_MIN_EXPOSED) ? 'medium' : 'low';
  return uncertain > 0 ? lower(level) : level;
}

const describeEvidence = (rows) => rows.map((r) => `${r.kind} on ${r.task}: ${r.verdict}, n=${r.n}${r.delta !== null ? `, delta ${r.delta}` : ''}${r.aaSpread !== null ? ` vs A/A spread ${r.aaSpread}` : ''}${r.runId ? `, run ${r.runId}` : ''}`).join('; ');
const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * The recommendation for one skill on one harness. Rules, in order: HARMS; unreachable (RELOCATE or PRUNE); FIX; KEEP
 * (evidence, preference, load rate); NEEDS DATA. Pure: every input is a plain value.
 * Input: harness, reachable, reachableElsewhere (and `elsewhere`, the harness names), assessedCount, cls ('uplift'|'preference'), exposed, coarse (runs whose
 * unnamed delegation may have reached the skill), runsLoaded, loads, evidence (rows for this skill and harness),
 * minExposure, signals ([{ type: 'spec-list'|'text'|'owner', text }]: signs the skill belongs to another harness), and the
 * optional hasTask (a bench task is linked to the skill) and delegatedOnly (offered only through delegated agents), which lower FIX confidence.
 */
function classify(i) {
  const ev = summarizeEvidence(i.evidence);
  const out = (klass, reason, confidence, wouldChange, provisional = false) => ({ class: klass, provisional, reason, confidence, wouldChange });
  const oc = i.harness === 'opencode';

  const thinHurts = ev.hurts && ev.hurtsN < MIN_EVIDENCE_N;
  if (ev.hurts && !thinHurts) {
    const conflict = ev.helps ? ' Other rows say it helps, so the evidence conflicts.' : '';
    return out('HARMS', `Evidence says it hurts: ${describeEvidence(i.evidence.filter((r) => r.verdict === 'hurts'))}.${conflict}`, evidenceConfidence(ev),
      'A repeat with more replicates in which the delta clears the A/A spread and the verdict is helps or none.');
  }

  if (!i.reachable) {
    if (i.signals.length) {
      const strong = i.signals.some((s) => s.type === 'spec-list');
      return out('RELOCATE', `No ${i.harness} agent can reach it, and it looks wired for another harness: ${i.signals.map((s) => s.text).join('; ')}. Keep it there, not here.`,
        strong ? 'medium' : 'low', 'Evidence it is used on another assessed harness (then keep it where it is listed), or a plan to load it on this one.');
    }
    if (i.reachableElsewhere) {
      return out('NEEDS DATA', `Not reachable on ${i.harness}. It is reachable on ${(i.elsewhere ?? ['another assessed harness']).join(', ')}. Unreachable on one harness is not a reason to prune.`, 'low',
        'Usage runs on the harness that installs it, or a decision on which harness owns it.');
    }
    return out('PRUNE', `No ${i.harness} agent lists it and nothing suggests another harness uses it.${i.assessedCount < 2 ? ' Only one harness was assessed, and this tool does not cover Claude Code.' : ''}`,
      i.assessedCount < 2 ? 'low' : 'medium', 'Any run that loads it, a registry owner or task for it, or a harness that is not assessed here and uses it.');
  }

  if (thinHurts) {
    return out('NEEDS DATA', `Evidence says it hurts, but only ${ev.hurtsN} run${ev.hurtsN === 1 ? '' : 's'} back${ev.hurtsN === 1 ? 's' : ''} that: ${describeEvidence(i.evidence.filter((r) => r.verdict === 'hurts'))}. HARMS needs at least ${MIN_EVIDENCE_N}.`, 'low',
      `A repeat with at least ${MIN_EVIDENCE_N} runs on the hurting rows, in which the delta clears the A/A spread.`);
  }

  const rate = i.exposed ? i.runsLoaded / i.exposed : null;
  const otherNote = i.signals.length ? ` It looks wired for another harness (${i.signals.map((x) => x.text).join('; ')}), yet ${i.harness} lists it.` : '';
  if (i.exposed >= i.minExposure && i.loads === 0) {
    let confidence = exposureConfidence(i.exposed, i.minExposure, i.coarse);
    if (i.hasTask === false && confidence === 'high') confidence = 'medium';
    if (i.delegatedOnly) confidence = lower(confidence);
    const caveats = [i.hasTask === false ? 'no bench task is linked to it' : null, i.delegatedOnly ? 'offered only through a delegated agent' : null].filter(Boolean);
    return out('FIX', `${oc ? 'In the index of every session' : 'Offered'} in ${i.exposed} runs and loaded 0 times. Exposed means it could be loaded, not that the task needed it; if it was needed, the cause is discovery, routing text or the description, not the body.${caveats.length ? ` Confidence is lower: ${caveats.join('; ')}.` : ''}${ev.helps ? ' Evidence says it helps when loaded, so that value is not being reached.' : ''}${otherNote}`,
      confidence, 'Loads after a description or routing change; trigger queries that should load it (cap trigger) showing a miss; or a forced-load comparison that shows no effect (then a prune review, not before).');
  }

  if (ev.helps) {
    return out('KEEP', `Evidence says it helps: ${describeEvidence(i.evidence.filter((r) => r.verdict === 'helps'))}.`, evidenceConfidence(ev),
      'A controlled result with verdict none or hurts at a larger n.');
  }
  if (i.cls === 'preference' && i.loads > 0) {
    return out('KEEP', `Registry class preference (tested for fidelity, not lift) and loaded ${i.loads} time${i.loads === 1 ? '' : 's'} in ${i.runsLoaded} of ${i.exposed} exposed runs.`, 'medium',
      'Zero loads over the minimum exposure moves it to FIX.');
  }
  if (i.exposed >= i.minExposure && i.runsLoaded * 10 >= i.exposed * 3) {
    const share = `${pct(rate)} (${i.runsLoaded} of ${i.exposed} exposed runs)`;
    if (ev.behaviorChange) {
      return out('KEEP', `Loaded in ${share} and the evidence file records a behavior change: ${describeEvidence(i.evidence.filter((r) => r.behaviorChange))}.`,
        ev.n >= 6 ? 'medium' : 'low', 'A controlled result showing the changed behavior does not matter, or load rate falling under 30%.');
    }
    return out('KEEP', `Loaded in ${share}. A high load rate shows the agent picks it up, not that it improves the result.`, 'low',
      'A controlled lift result (helps or none) or a recorded behavior change in the evidence file.', true);
  }

  const evidenceNote = i.evidence.length ? ` Evidence on file: ${describeEvidence(i.evidence)}.` : '';
  if (i.exposed < i.minExposure) {
    return out('NEEDS DATA', `Exposed in ${i.exposed} run${i.exposed === 1 ? '' : 's'}, under the minimum of ${i.minExposure}.${i.loads ? ` Loaded ${i.loads} time${i.loads === 1 ? '' : 's'}.` : ''}${evidenceNote}${otherNote}`, 'low',
      `At least ${i.minExposure} exposed runs, or a controlled result in the evidence file.`);
  }
  return out('NEEDS DATA', `Loaded in ${pct(rate)} (${i.runsLoaded} of ${i.exposed} exposed runs), under the ${pct(LOAD_RATE_MIN)} threshold (our own), with ${ev.behaviorChange ? 'a behavior change on file but no result showing an effect' : 'no evidence of effect'}.${evidenceNote}${otherNote}`, 'low',
    'A controlled result in the evidence file, or a higher load rate over more runs.');
}

// A skill some kiro agent lists is used on kiro, so a claudeCli list or a mention of Claude Code says nothing about
// a different home for it. Signs only count for a skill no kiro agent lists.
function signalsFor(rec) {
  const out = [];
  if ((rec.reach.kiro?.agents ?? []).length > 0) return out;
  const agents = rec.reach.claude?.agents ?? [];
  if (agents.length) out.push({ type: 'spec-list', text: `listed in the claudeCli skills of ${agents.join(', ')}` });
  if (CLAUDE_TEXT.test(`${rec.name} ${rec.description.text}`)) out.push({ type: 'text', text: 'its description names Claude Code' });
  if (rec.owner && /claude/i.test(rec.owner)) out.push({ type: 'owner', text: `registry owner ${rec.owner}` });
  return out;
}

const emptyCounts = () => Object.fromEntries([...CLASSES.filter((c) => c !== 'KEEP'), 'KEEP', 'KEEP (provisional)'].map((c) => [c, 0]));
const labelOf = (c) => (c.class === 'KEEP' && c.provisional ? 'KEEP (provisional)' : c.class);

/**
 * Builds the report. `runDirs` are run directories (read only); `evidence` is { file, rows, warnings } from loadEvidence.
 * Throws on an unresolvable base, an invalid harness or a minExposure under MIN_EXPOSURE_FLOOR.
 */
function buildPruneReport({ repo, base, harness = 'both', benchDir, runDirs = [], evidence = null, minExposure = DEFAULT_MIN_EXPOSURE, now = new Date() }) {
  if (!Number.isInteger(minExposure) || minExposure < MIN_EXPOSURE_FLOOR) throw new Error(`minimum exposure takes a whole number of at least ${MIN_EXPOSURE_FLOOR}`);
  const { report: audit } = runAudit({ repo, base, harness, benchDir });
  const harnesses = harness === 'both' ? ['kiro-cli', 'opencode'] : [harness];
  const skills = audit.capabilities.filter((c) => c.kind === 'skill');
  const bytesOf = (id) => audit.capabilities.find((c) => c.id === id)?.bytes ?? 0;
  const warnings = [];
  const listedBy = (id) => Object.entries(audit.matrix.kiro?.[id] ?? {}).filter(([, v]) => v).map(([a]) => a);

  const scan = scanRunDirs(runDirs, { harnesses });
  const usage = tallyUsage(scan.runs, skills.map((c) => ({ id: c.id, name: c.name })), listedBy, harnesses);
  if (!runDirs.length) warnings.push('no run directories were given (--runs, --runs-glob), so no usage was read; classes come from reach and size alone');

  if (scan.staleInstalled) warnings.push(`${scan.staleInstalled} run(s) kept the installed file of a different agent than the one that started them (older runs saved konductor.json for every entry agent); their skill filter was ignored and the base tree's listing for the entry agent was used`);
  const knownAgents = new Set(audit.matrix.agents);
  const unknownDelegates = new Set(scan.runs.flatMap((r) => r.delegated).filter((a) => !knownAgents.has(a)));
  if (unknownDelegates.size) warnings.push(`runs delegated to agents that are not in the base tree and were not counted as exposure: ${[...unknownDelegates].sort().join(', ')}`);

  const evByKey = new Map();
  for (const w of evidence?.warnings ?? []) warnings.push(`evidence: ${w}`);
  const skillIds = new Set(skills.map((c) => c.id));
  for (const r of evidence?.rows ?? []) {
    if (!skillIds.has(r.capId)) { warnings.push(`evidence row for ${r.capId} ignored: not a skill at ${audit.base.label}`); continue; }
    if (!harnesses.includes(r.harness)) { warnings.push(`evidence row for ${r.capId} on ${r.harness} ignored: that harness is not assessed`); continue; }
    const k = `${r.capId}|${r.harness}`;
    evByKey.set(k, [...(evByKey.get(k) ?? []), r]);
  }

  const p90 = percentile90(skills.map((c) => c.bytes));
  const counts = Object.fromEntries(harnesses.map((h) => [h, emptyCounts()]));
  let trimCount = 0;
  const capabilities = skills.map((rec) => {
    const trim = trimFor(rec, p90, bytesOf);
    if (trim.flag) trimCount++;
    const reachable = { 'kiro-cli': (rec.reach.kiro?.agents ?? []).length > 0, opencode: rec.reach.opencode === true };
    const otherHarness = { signals: signalsFor(rec) };
    const perHarness = {};
    for (const h of harnesses) {
      const u = usage[h][rec.id];
      const rows = evByKey.get(`${rec.id}|${h}`) ?? [];
      const classification = classify({
        harness: h, reachable: reachable[h], reachableElsewhere: harnesses.some((o) => o !== h && reachable[o]), elsewhere: harnesses.filter((o) => o !== h && reachable[o]), assessedCount: harnesses.length, cls: rec.class,
        exposed: u.exposed, coarse: u.uncertain, runsLoaded: u.runsLoaded, loads: u.loads, evidence: rows, minExposure, signals: otherHarness.signals,
        hasTask: rec.tasks.linked.length + rec.tasks.byTarget.length > 0, delegatedOnly: u.exposed > 0 && (u.basis.delegated ?? 0) + (u.basis.loaded ?? 0) === u.exposed,
      });
      counts[h][labelOf(classification)]++;
      perHarness[h] = {
        reachable: reachable[h],
        agents: h === 'kiro-cli' ? rec.reach.kiro?.agents ?? [] : null,
        exposure: { runs: u.exposed, coarse: u.uncertain, basis: u.basis },
        loads: { runsLoaded: u.runsLoaded, total: u.loads, rate: u.exposed ? u.runsLoaded / u.exposed : null, bytes: u.bytes, meanBytesPerLoad: u.loads ? Math.round(u.bytes / u.loads) : null },
        byRef: u.byRef,
        evidence: rows,
        classification,
      };
    }
    return {
      id: rec.id, name: rec.name, path: rec.path, bytes: rec.bytes, estTokens: rec.estTokens, descriptionBytes: Buffer.byteLength(rec.description.text),
      descriptionChars: rec.description.length, useWhenCue: rec.description.useWhen, descriptionStyle: rec.description.style,
      registered: rec.registered, owner: rec.owner, registryClass: rec.class, linkedTasks: rec.tasks.linked, inboundRefs: rec.inbound.length,
      neighbours: rec.neighbours, trim, otherHarness, harnesses: perHarness,
    };
  });

  const refRows = new Map();
  for (const r of scan.runs) {
    const k = `${r.harness}|${r.refKey}`;
    const cur = refRows.get(k) ?? { ref: r.refKey, harness: r.harness, variant: r.variant, matchesBase: r.variant || !audit.base.commitSha ? null : r.refKey.endsWith(`@${audit.base.commitSha.slice(0, 7)}`), runs: 0, coarse: 0 };
    cur.runs++;
    if (r.delegationUnnamed) cur.coarse++;
    refRows.set(k, cur);
  }
  const refs = [...refRows.values()].sort((a, b) => (a.harness + a.ref < b.harness + b.ref ? -1 : 1));
  if (new Set(refs.filter((r) => !r.variant).map((r) => `${r.harness}|${r.ref.split('@')[0]}`)).size < refs.filter((r) => !r.variant).length) {
    warnings.push('one ref name appears at more than one commit; each commit is its own row below');
  }
  const offBase = refs.filter((r) => r.matchesBase === false);
  if (offBase.length) warnings.push(`runs built from a different commit than the base ${audit.base.label}: ${[...new Set(offBase.map((r) => r.ref))].join(', ')}; their exposure comes from the installed agent filter where the run kept it, otherwise from the base tree`);
  if (refs.length > 1) warnings.push(`overall counts combine ${refs.length} ref rows (${refs.map((r) => `${r.ref} on ${r.harness}`).join(', ')}); the per-ref counts are in each capability's byRef and in the usage table`);
  if (harnesses.includes('opencode') && scan.runs.some((r) => r.harness === 'opencode')) warnings.push('opencode loads come from the parent session only; subagent sessions are not in the stream');

    const oc = skills.map((c) => ({ id: c.id, bytes: Buffer.byteLength(c.name) + Buffer.byteLength(c.description.text) })).sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1));
  const ocTotal = oc.reduce((n, c) => n + c.bytes, 0);
  const kiroLoads = harnesses.includes('kiro-cli') ? Object.values(usage['kiro-cli']).reduce((a, t) => ({ loads: a.loads + t.loads, bytes: a.bytes + t.bytes }), { loads: 0, bytes: 0 }) : { loads: 0, bytes: 0 };
  const costContext = {
    estimateNote: 'Token figures are bytes / 4, an estimate, not a tokenizer count.',
    opencode: {
      skillCount: skills.length, indexBytes: ocTotal, estTokens: estTokens(ocTotal), indexBytesAudit: audit.startup.opencode?.skillIndexBytes ?? null,
      note: 'opencode puts the name and description of every skill in each session at startup, so every description is paid for whether or not the skill loads.',
      top: oc.slice(0, 10).map((c) => ({ id: c.id, bytes: c.bytes, estTokens: estTokens(c.bytes), share: ocTotal ? c.bytes / ocTotal : 0 })),
    },
    kiro: {
      note: 'kiro-cli loads a skill on demand through get_skill, so an unused skill adds nothing to a session; the cost is the bytes a load returns.',
      skillDescriptionBytesAtStartup: 0,
      observedLoads: { loads: kiroLoads.loads, bytes: kiroLoads.bytes, meanBytesPerLoad: kiroLoads.loads ? Math.round(kiroLoads.bytes / kiroLoads.loads) : null },
      agentStartup: audit.startup.kiro,
    },
  };

  const notes = [
    'Every class is a recommendation based on the inputs listed above, never a deletion. A person decides.',
    'Only skills are classified. SOPs are prompts on kiro-cli, and agents and context files are not assessed here.',
    `Exposure counts non-vanilla runs that offered the skill: kiro-cli by the entry agent's own installed skill filter (else the agents listing it at ${audit.base.label}) plus any agent the stream shows the run delegating to; opencode by every run. Runs with an unnamed delegation are labelled coarse.`,
    'Exposed means an agent in the run could load the skill, not that the task needed it. The runs were not built around each skill, so FIX is a prompt to check discovery, not proof of a discovery problem.',
    'A load rate shows the agent picks a skill up. It is not evidence the skill improves a result; only the evidence file or a controlled run is.',
    'The evidence file is maintained by hand.',
    LOAD_RATE_NOTE,
    OWN_THRESHOLDS_NOTE,
  ];

  return {
    schemaVersion: 1, toolVersion: TOOL_VERSION, createdAt: now.toISOString(), harnesses, minExposure,
    base: audit.base,
    inputs: {
      runDirs: scan.dirs.map((d) => ({ dir: d.dir, counted: d.counted, skipped: d.skipped })),
      evidence: evidence ? { file: evidence.file, rows: evidence.rows.length } : null,
      loadRateMin: LOAD_RATE_MIN, nearDuplicateMin: NEAR_DUPLICATE_MIN, sizeP90Bytes: p90,
    },
    usage: {
      runs: { counted: scan.runs.length, staleInstalledAgent: scan.staleInstalled, coarse: scan.runs.filter((r) => r.delegationUnnamed).length, byHarness: Object.fromEntries(harnesses.map((h) => [h, scan.runs.filter((r) => r.harness === h).length])) },
      skipped: scan.skipped, refs,
    },
    costContext,
    summary: {
      skills: skills.length, byHarness: counts, trim: trimCount,
      needsDataShare: Object.fromEntries(harnesses.map((h) => [h, { count: counts[h]['NEEDS DATA'], of: skills.length, share: skills.length ? counts[h]['NEEDS DATA'] / skills.length : 0 }])),
    },
    capabilities, warnings, notes,
  };
}

// ---- markdown ----

const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const rateText = (l) => (l.rate === null ? '-' : pct(l.rate));

function classRows(report, wanted) {
  const rows = [];
  for (const c of report.capabilities) {
    for (const [h, v] of Object.entries(c.harnesses)) {
      const k = v.classification;
      if (k.class === wanted.class && (wanted.provisional === undefined || k.provisional === wanted.provisional)) rows.push({ c, h, v, k });
    }
  }
  return rows.sort((a, b) => (a.h + a.c.id < b.h + b.c.id ? -1 : 1));
}

function renderPrune(report, { compact = false } = {}) {
  const L = [];
  const s = report.summary;
  L.push('# Prune report', '');
  L.push(`Base: ${report.base.label}${report.base.commitSha ? ` (${report.base.commitSha.slice(0, 10)})` : ''}; harness: ${report.harnesses.join(', ')}; minimum exposure ${report.minExposure} runs; created ${report.createdAt}; ${report.toolVersion}.`, '');
  for (const n of report.notes) L.push(`- ${n}`);
  L.push('', '## Inputs', '');
  L.push(`Run directories: ${report.inputs.runDirs.length}; runs counted: ${report.usage.runs.counted} (${Object.entries(report.usage.runs.byHarness).map(([h, n]) => `${h} ${n}`).join(', ')}); coarse exposure in ${report.usage.runs.coarse}.`);
  L.push(`Left out: ${Object.entries(report.usage.skipped).map(([k, n]) => `${k} ${n}`).join(', ')}.`);
  L.push(`Evidence: ${report.inputs.evidence ? `${report.inputs.evidence.rows} row(s) from ${report.inputs.evidence.file}` : 'none'}.`);
  for (const w of report.warnings) L.push(`Warning: ${w}.`);

  L.push('', '## Summary', '');
  const keys = Object.keys(s.byHarness[report.harnesses[0]]);
  L.push(table(['class (recommendation)', ...report.harnesses], keys.map((k) => [k, ...report.harnesses.map((h) => s.byHarness[h][k])])), '');
  L.push(`Skills assessed: ${s.skills}. TRIM candidates (flag beside the class): ${s.trim}. NEEDS DATA share: ${report.harnesses.map((h) => `${h} ${s.needsDataShare[h].count} of ${s.needsDataShare[h].of} (${pct(s.needsDataShare[h].share)})`).join('; ')}.`);

  const head = ['skill', 'harness', 'exposed runs', 'runs loaded', 'load rate', 'confidence', 'reason'];
  const line = ({ c, h, v, k }) => [c.id, h, `${v.exposure.runs}${v.exposure.coarse ? ' (coarse)' : ''}`, v.loads.runsLoaded, rateText(v.loads), k.confidence, k.reason];
  const section = (title, rows, intro) => {
    L.push('', `## ${title}`, '');
    if (intro) L.push(intro, '');
    if (!rows.length) { L.push('none.'); return; }
    L.push(table(head, rows.map(line)), '');
    const changes = new Map();
    for (const r of rows) changes.set(r.k.wouldChange, (changes.get(r.k.wouldChange) ?? 0) + 1);
    L.push('What would change this:', ...[...changes].map(([text, n]) => `- ${text}${changes.size > 1 ? ` (${n} row${n === 1 ? '' : 's'})` : ''}`));
  };
  section('HARMS', classRows(report, { class: 'HARMS' }), 'Evidence says the skill makes results worse. Highlighted first.');
  section('RELOCATE', classRows(report, { class: 'RELOCATE' }), 'Unreachable here and wired for another harness: keep it there.');
  section('PRUNE', classRows(report, { class: 'PRUNE' }), 'Candidates only. Unreachable on every assessed harness with no sign of another.');
  section('FIX', classRows(report, { class: 'FIX' }), 'Offered often and never loaded. Fix discovery, routing text or the description; do not delete.');
  section('KEEP', [...classRows(report, { class: 'KEEP', provisional: false }), ...classRows(report, { class: 'KEEP', provisional: true })], 'Provisional means a load rate with no evidence of effect.');

  L.push('', '## TRIM', '', 'Flag beside the class: bytes above the 90th percentile of skills, or a near duplicate above 0.6. Trimming moves detail into references or merges; it does not delete.', '');
  const trims = report.capabilities.filter((c) => c.trim.flag);
  L.push(trims.length ? table(['skill', 'bytes', 'est. tokens', 'why', 'neighbour and sizes', 'class'], trims.map((c) => [
    c.id, c.bytes, c.estTokens,
    c.trim.reasons.map((r) => (r.type === 'size' ? `over p90 (${r.p90} bytes)` : `near duplicate ${r.score}`)).join('; '),
    c.trim.reasons.filter((r) => r.type === 'near-duplicate').map((r) => `${r.neighbour}: ${r.neighbourBytes} bytes vs ${r.bytes}`).join('; ') || '-',
    Object.entries(c.harnesses).map(([h, v]) => `${h}: ${labelOf(v.classification)}`).join(', '),
  ])) : 'none.');

  const needs = classRows(report, { class: 'NEEDS DATA' });
  L.push('', '## NEEDS DATA', '');
  if (compact) L.push(`${needs.length} skill/harness rows. The full list is in prune-report.md and prune-report.json.`);
  else L.push(needs.length ? table(['skill', 'harness', 'exposed runs', 'runs loaded', 'reason'], needs.map(({ c, h, v, k }) => [c.id, h, v.exposure.runs, v.loads.runsLoaded, k.reason])) : 'none.');

  const cc = report.costContext;
  L.push('', '## Cost context', '', cc.estimateNote, '');
  L.push(`opencode: ${cc.opencode.skillCount} skill descriptions are in every session at startup, ${cc.opencode.indexBytes} bytes (estimate ${cc.opencode.estTokens} tokens). ${cc.opencode.note}`, '');
  L.push('Ten biggest startup contributors on opencode (name plus description):', '', table(['skill', 'bytes', 'est. tokens', 'share of the index'], cc.opencode.top.map((t) => [t.id, t.bytes, t.estTokens, pct(t.share)])), '');
  L.push(`kiro-cli: ${cc.kiro.note} Description bytes at startup: ${cc.kiro.skillDescriptionBytesAtStartup}. Observed in the counted runs: ${cc.kiro.observedLoads.loads} loads, ${cc.kiro.observedLoads.bytes} bytes returned${cc.kiro.observedLoads.meanBytesPerLoad !== null ? ` (mean ${cc.kiro.observedLoads.meanBytesPerLoad} per load)` : ''}.`);

  L.push('', '## Usage by ref', '');
  L.push(report.usage.refs.length ? table(['ref', 'harness', 'runs counted', 'coarse exposure', 'variant', 'same commit as base'], report.usage.refs.map((r) => [r.ref, r.harness, r.runs, r.coarse, r.variant ? 'yes' : 'no', r.matchesBase === null ? 'n/a' : r.matchesBase ? 'yes' : 'no'])) : 'No runs counted.');
  L.push('', 'Per-capability counts by ref are in prune-report.json under `byRef`.');
  return `${L.join('\n')}\n`;
}

module.exports = { buildPruneReport, renderPrune, classify, trimFor, percentile90, TOOL_VERSION, CLASSES, OWN_THRESHOLDS_NOTE, LOAD_RATE_NOTE, DEFAULT_MIN_EXPOSURE, MIN_EXPOSURE_FLOOR, HIGH_MIN_EXPOSED };
