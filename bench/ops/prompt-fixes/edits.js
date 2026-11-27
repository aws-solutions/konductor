// SPDX-License-Identifier: Apache-2.0
'use strict';

// The text edits of the konductor prompt-fix spec (reports/konductor-prompt-fixes-2026-11-27.md, Fixes 1 to 9), as
// applied to konductor c042c7ba. build-candidates.js applies them in this order; each `before` (or `from` and `to`)
// must be found exactly once in the text as it stands after the earlier edits, else the build fails.
//
// An edit is one of:
//   { fix, file, before, after }        replace the one occurrence of `before` with `after`
//   { fix, file, from, to, after }      replace the span that starts at `from` and ends just before `to`
//   { fix, file, from, to, moveTo }     cut that span and append it to file `moveTo` (created when missing)
//   { fix, file, append }               append text at the end
// `file` is a repo path, or `agents/konductor.agent-spec.json#systemPrompt` for the orchestrator prompt string.
// Two deviations from the spec text, both to keep konductor's own tests and clauses whole: the exemption report
// sentence at prompt:61 stays (tests/test_pr144_docs_text.py asserts it), and Fix 8 keeps the Review ceilings sentence.

const BASE = 'c042c7ba7520a3332f1151e3f9733f7033557e65';
const DW = 'context/k-direct-work.md';
const CORE = 'context/k-core-rules.md';
const PROMPT = 'agents/konductor.agent-spec.json#systemPrompt';

// Fix 3's Skills paragraph: its first sentence is the line; the rest says how to choose. P1 moves the rest.
const SKILLS_HOW = 'Choose from the skill list by its trigger words and by the words of the task. Load each skill you name with `get_skill`, at most 3, before you start the work. A task that says review, check, fact-check, design, threat model, requirements or tests has a skill on this list, so look first. Skip the line only for a question or a one-line edit. Workspace skills named `ws-*` also count; read them from `.kiro/skills/<name>/SKILL.md`.';
const SKILLS_PARAGRAPH = `\n\nBefore your first write or spawn, put one line in your reply: \`Skills: <name>, <name>\` or \`Skills: none fit\`. ${SKILLS_HOW}`;

const EDITS = [
  // Fix 7, E7.1: the plan rule replaces the first four sentences of k-direct-work.md:3.
  {
    fix: '7',
    file: DW,
    before: 'You do the work yourself. Read, search, write, edit and run commands: every step of the task, in this one session, so the context you build up is the context the work uses. Commit only when the user asks, as `k-developer` does. Do not hand a task to a specialist because a role name fits it.',
    after: 'Decide how to work before your first write or spawn. You may look first with read-only commands (`ls`, `git status --short`, open the files the request names). Then write one line in your reply: `Plan: solo, because <signals>` or `Plan: team (<agents>), because <signals>`. Signals: how many independent parts, how many files and lines each, how many phases the request asks for, any risk flag (auth, secrets, personal or stored data, schema, infrastructure, public contract), and whether this is a clean git repo. Small work is always solo: one part, or three files or fewer and about 150 lines or fewer. Two or more independent parts that each have about 40 lines or 2 files or more are a team: one writer per part, up to 4 at once. A request for three or more phases end to end is a team: the owner of each phase in order. Risk does not make a team; it decides the review. What the user says wins ("work alone", "use agents"). When the plan is solo, you do every step yourself, in this one session, so the context you build up is the context the work uses. Commit only when the user asks, as `k-developer` does. Do not hand a task to a specialist because a role name fits it; hand it over when the plan says team.',
  },
  // Fix 4: the task-wording to skill sentence, after the infra-validation sentence of :3.
  {
    fix: '4',
    file: DW,
    before: 'after an infrastructure change (CDK, CloudFormation), load `infra-validation`.',
    after: 'after an infrastructure change (CDK, CloudFormation), load `infra-validation`. Before you review, check or write a design doc, also load the skill that matches the words of the request: `adversarial-design-review` to challenge its decisions ("review the design", "stress-test", "challenge"); `design-quality-check` to judge whether it is ready to send ("ready for review", "is this clear"); `doc-accuracy-analyzer` to fact-check its claims ("verify", "fact-check", "are the numbers right"); `system-design-patterns` to write a design for a new service or feature from requirements.',
  },
  // Fix 1: do not stop at the SOP name when nobody can answer (:5).
  {
    fix: '1',
    file: DW,
    before: 'and you stop there: typing the command is the consent. Any other request, including one an SOP would cover as a single phase, you do now; you may name the SOP in passing. Never stop at a name for a plain task.',
    after: 'and you stop there: typing the command is the consent. Stop only when a person can answer. If the request already says to go ahead, gives the parameters, or nobody can answer, do not stop at the name: do the task now, use the SOP\'s steps as your checklist, and say in one line why you did not stop. A request for three or more phases end to end is a team plan (see the plan rule); run the SOP\'s steps as that team, with `reply_channel_available=false` where the SOP has it. Any other request, including one an SOP would cover as a single phase, you do now; you may name the SOP in passing. Never stop at a name for a plain task.',
  },
  // Fix 8: the review paragraph (:19) as a table, fitted to the plan. The Review ceilings sentence is kept.
  {
    fix: '8',
    file: DW,
    from: 'Review happens at phase gates. When a phase ends (requirements, design,',
    to: '\n\nWhen an SOP you run tells you to spawn an agent',
    after: [
      'Review happens at phase gates. When a phase ends, spawn the reviewer your Verification Protocol names, once, on that phase\'s whole output. Under a team plan the phase ends when you have integrated the parts, and the one reviewer reads the combined result.',
      '',
      '| The phase made | Gate review? | If not, run this checker skill instead |',
      '| --- | --- | --- |',
      '| a threat model; a design for authentication, authorization or credential handling; a design that exposes a service or data across a network boundary; a design that handles personal or sensitive data | always | none |',
      '| code | yes, unless Verification Protocol item 2 exempts it | none |',
      '| another document (requirements, a design, a plan) | when the user asks for one, when the SOP names one, or when a later phase of this task will build it | `design-evaluation` for a design or threat model, `plan-review` for a plan or work breakdown, `user-story-writing` for requirements |',
      '| a data model, schema or deployment configuration that does none of the "always" things | not by itself | as above |',
      '',
      'Run the checker yourself when your skill tool lists the skill. When it does not, spawn the document\'s reviewer from Verification Protocol item 1 with a brief that names the skill and asks for findings only. Treat what the check finds as review findings under Review ceilings; a finding you would reject goes to the user first when a person can answer, and otherwise goes in your final reply with your reason. Whether the check or the gate review found it, apply Review ceilings (Verification Protocol item 6): one fix and one re-check or re-review as item 6 scopes it, done the same way as the first; move on when it passes, stop and report as item 6 says, and list what item 6 calls pre-existing.',
      '',
      'The brief: the paths, the acceptance criteria and the user\'s stated constraints, not your reasoning. Tell the reviewer to write nothing in the repository and to return findings by severity and a PASS line, never a question. It reads your tree while you wait; it needs no separate checkout. Name the same checker skill in the brief, and `backend-review` or `frontend-review` for code under the same stack condition; otherwise ask for a review against the codebase\'s conventions. Do not spawn a reviewer per file or per edit. In Verification Protocol item 2, auth means authentication and authorization code, secrets means credentials and the files that hold them, data means stored data, its schema, migrations and input validation, and infrastructure means deploy and runtime configuration.',
    ].join('\n'),
  },
  // Fix 7, E7.2: the spawn rule (:21).
  {
    fix: '7',
    file: DW,
    before: 'spawn a specialist in two cases only: a step needs a tool, access, skill or SOP you lack (browser, media, an external system, a skill your skill tool does not list, or an SOP you do not declare: the specialist that declares it runs it from your brief with the SOP name and parameters; do not read its installed copy), or the task has genuinely independent parts on disjoint files that can run at the same time. You count as a write agent: put your own files in the disjoint-file check, give every spawned writer its own worktree while you keep writing in this tree, and stage only the paths you changed.',
    after: 'spawn a specialist in two cases only: your plan is `team`, or a step needs a tool, access, skill or SOP you lack (browser, media, an external system, a skill your skill tool does not list, or an SOP you do not declare: the specialist that declares it runs it from your brief with the SOP name and parameters; do not read its installed copy). Under a team plan each writer owns files no other writer touches. In a clean git repo give each writer its own worktree. With no git, give each its own directory or file list, and check afterwards that no file was touched twice. Under a team plan you do not write; you brief, integrate and check. Under a solo plan you are the only writer, so stage only the paths you changed.',
  },
  {
    fix: '7',
    file: DW,
    before: 'propose the split to the user first, so commits from the parallel work land on their branch only with their agreement, or merge the parts in uncommitted',
    after: 'propose the split to the user first when the user is waiting, or merge the parts in uncommitted (always, when nobody can answer)',
  },
  // Fix 1: a missing tool is a plan change, not a stop (:21).
  {
    fix: '1',
    file: DW,
    before: 'If you lack a tool and no specialist has it, say so plainly and offer an alternative.',
    after: 'If you lack a tool and no specialist has it, say so in one line, then do the closest thing you can do now (a missing multiplexer: plain subagents in worktrees; a missing browser: the closest read-only check) and say so in a `Plan changed:` line. Stop and ask only when every alternative would change what the user asked for or cost something they did not approve, and a person can answer.',
  },
  // Fix 7, E7.3: the mode rule names the plan line (k-core-rules.md:41).
  {
    fix: '7',
    file: CORE,
    before: '`konductor` has two modes, `auto` and `coordinator`.',
    after: '`konductor` has two modes, `auto` and `coordinator`. In `auto` you choose per task between working alone and bringing in specialists, as the Direct Work plan rule says, and your first reply says which in a `Plan:` line after the mode line.',
  },
  // Fix 6: the specialist handoffs leave k-core-rules.md for k-specialist-rules.md (the k-* agents load it).
  { fix: '6', file: CORE, from: '## Specialist handoffs\n', to: '## House rules\n', moveTo: 'context/k-specialist-rules.md' },
  // Fix 7, E7.4.
  {
    fix: '7',
    file: PROMPT,
    before: 'Run your Direct Work rules\' SOP check on every request before you start or route any work.',
    after: 'Run your Direct Work rules\' SOP check on every request before you start or route any work. Then write your Plan line.',
  },
  // Fix 5 and Fix 2 (prompt:61). The exemption report sentence stays; the narrowing and the Review gate line follow it.
  {
    fix: '5,2',
    file: PROMPT,
    before: 'unless it touches auth, secrets, data, or infrastructure. When you use this exemption, say so in your status report with the diff stat.',
    after: 'unless it touches auth, secrets, data, or infrastructure. When you use this exemption, say so in your status report with the diff stat. The exemption covers one file only: two or more files, several branches, or a merge are never exempt. Reading stored or customer data, even without a write, counts as data. Every final reply that follows a file change ends with one line: `Review gate: ran <agent>` or `Review gate: not needed, <the exemption>, <diff stat>`.',
  },
  // Fix 9 (D3 yes): the review ceiling delivers with the open finding (prompt:66).
  {
    fix: '9',
    file: PROMPT,
    before: 'blocks done: stop work on that artifact and on what depends on it, finish or report the independent artifacts, and report the finding to the user as unresolved.',
    after: 'blocks done as a clean pass: finish the other artifacts, leave the artifact as it is, and end your final reply with `UNRESOLVED:` and each open finding with its location. When a person can answer, ask them. When nobody can, do not stop.',
  },
  // Fix 6: the k-light-ui-testing special case (prompt:36-38) and the TODO block (prompt:68-80) go; prompt:9 stays.
  { fix: '6', file: PROMPT, from: '## Direct-Execution Exception: `k-light-ui-testing`\n', to: '## 2-Strike Circuit Breaker\n', after: '' },
  { fix: '6', file: PROMPT, from: '## TODO Tracking\n', to: '## Communication Style\n', after: '' },
  // Fix 1 (prompt:86).
  {
    fix: '1',
    file: PROMPT,
    before: '- If a task is ambiguous, ask ONE clarifying question. Do not guess.',
    after: '- If a task is ambiguous and a wrong guess would be costly or hard to undo, ask ONE clarifying question. Otherwise pick the most likely reading, say it in one line, and go on. If nobody can answer, do not stop to ask.',
  },
  // Fix 2: the self-check runs before the final reply (prompt:89-93).
  {
    fix: '2',
    file: PROMPT,
    from: '## Mid-Conversation Self-Check\n',
    to: '- Did every spawn this turn',
    after: '## Self-Check\n\nBefore your final reply, and again after every 5 messages, verify:\n\n- Does what I did match my Plan line? If not, is there a `Plan changed:` line?\n- Is the `Review gate:` line there, and does it name a reviewer or a real exemption?\n',
  },
  // Fix 3: the Skills line, as the last paragraph of the prompt (the synth block is built at install and cannot be edited by an arm).
  {
    fix: '3',
    file: PROMPT,
    append: SKILLS_PARAGRAPH,
  },
  // Fix 7, E7.7: the two doc lines (not installed; konductor's own tests read them).
  {
    fix: '7',
    file: 'cli/README.md',
    before: '`auto` (the default, single-writer) or',
    after: '`auto` (the default: chooses per task whether to work alone or use specialists, and says so in a `Plan:` line) or',
  },
  {
    fix: '7',
    file: 'docs/user-guide/concepts.md',
    before: '`konductor` ships in its single-writer shape: it reads, writes and runs commands itself and spawns a\nfresh `k-*` reviewer',
    after: '`konductor` ships in its adaptive shape: for small work it reads, writes and runs commands itself; for work with independent parts or several phases it hands the parts to specialists. Either way it spawns a\nfresh `k-*` reviewer',
  },
];

// P1 and P2 of reports/adaptive-prompt-cap-check-2026-11-27.md, applied after EDITS for the reply-check candidate arm
// (build-candidates.js --with p1p2). The frozen konductor-adaptive arm is EDITS alone.
const REPLY_EDITS = [
  // P1: one header rule next to the mode line, with the Skills paragraph's how-to under it.
  {
    fix: 'P1',
    file: PROMPT,
    before: '- Your first reply states your orchestration mode once, as the core rules say.',
    after: `- Your first message starts with these lines, in this order, before any tool call: the mode line the core rules give (\`Orchestration: auto (default)\` when no hook set one), then \`Plan: solo, because <signals>\` or \`Plan: team (<agents>), because <signals>\`, then \`Skills: <name>, <name>\` or \`Skills: none fit\`. When you need a read-only look to choose, write \`Plan: after a read-only look\` there, and put the real \`Plan:\` line first in your next message, before any write or spawn.\n  ${SKILLS_HOW}`,
  },
  { fix: 'P1', file: PROMPT, before: SKILLS_PARAGRAPH, after: '' },
  {
    fix: 'P1',
    file: DW,
    before: 'Then write one line in your reply: `Plan: solo, because <signals>` or `Plan: team (<agents>), because <signals>`.',
    after: 'Then write the Plan line (Communication Style).',
  },
  {
    fix: 'P1',
    file: CORE,
    before: 'and your first reply says which in a `Plan:` line after the mode line.',
    after: 'and your first reply says which in the Plan line (Communication Style).',
  },
  // P2: the self-check also runs at the moment the lines are due.
  {
    fix: 'P2',
    file: PROMPT,
    before: 'Before your final reply, and again after every 5 messages, verify:\n\n',
    after: 'Before your first write or spawn, before your final reply, and again after every 5 messages, verify:\n\n- Are my `Plan:` and `Skills:` lines already in a message? If not, write them now, before the write or spawn.\n',
  },
];

// The files an arm replaces or adds (cap variant ops); the docs are applied only to the test copy.
const ARM_FILES = {
  replace: { 'context:k-direct-work': DW, 'context:k-core-rules': CORE, 'agent:konductor': 'agents/konductor.agent-spec.json' },
  add: { 'context:k-specialist-rules': 'context/k-specialist-rules.md' },
  addTo: ['k-architect', 'k-browser', 'k-developer', 'k-media-analyzer', 'k-product-manager', 'k-quality-assurance', 'k-researcher', 'k-tpm'],
};

module.exports = { BASE, EDITS, REPLY_EDITS, ARM_FILES };
