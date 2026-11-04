# Control skills

A control is a skill whose right verdict is known in advance. A run that does not reach it shows a
fault in the method, and the verdicts it gave to real skills should not be trusted. Three controls
run next to the real skills.

This file is the only place that says what the control skills are. It is never copied into an arm,
never shown to a subject or a judge, and no `SKILL.md` below may name its own role, say that it
is a test, or hint at its expected verdict. A `SKILL.md` reads as ordinary team guidance.

## Layout

| Path                               | What it holds                                                |
| ---------------------------------- | ------------------------------------------------------------ |
| `keep/SKILL.md`                    | the known-good skill (`tarnwick-conventions`)                |
| `prune/SKILL.md`                   | the known-bad skill (`team-coding-notes`)                    |
| `null/SKILL.md`                    | the neutral skill both arms receive (`plain-writing-habits`) |
| `tasks/<control>.json`             | one task set per control, in the task schema's fields        |
| `treatment/team-coding-notes.json` | the treatment check for the known-bad skill                  |

A skill folder holds only its `SKILL.md`, so a folder can be installed in an arm as it is. Task
sets, rubrics and specs sit elsewhere and never reach a subject. The manifest in
`bench/lib/controls.js` lists the controls, their expected verdicts and their kinds.

## The three controls

| Control | Skill                  | Expected verdict     | Kind           | Tasks |
| ------- | ---------------------- | -------------------- | -------------- | ----- |
| keep    | `tarnwick-conventions` | `keep`               | skill-specific | 10    |
| prune   | `team-coding-notes`    | `prune`              | harmful        | 12    |
| null    | `plain-writing-habits` | `needs human review` | identical arms | 10    |

### keep

Conventions of an invented team (`Tarnwick`) for a commit subject, a service log line and an
environment variable name. No model can know them from training data, and each task asks for the
team's format, so only a run with the skill can answer correctly. The with arm should win by a wide
margin, and the verdict is `keep`. The manifest marks it `skill_specific: true`: its wording is the
point, so the skill-wording lint that stops a check from rewarding copied skill text does not apply
to it.

### prune

Three coding directions that are plainly worse than the usual answer, written as ordinary guidance:
a bare `except:` that returns `{}` when a settings file fails to load, floats for money totals, and
an immediate retry loop with no delay and no limit. A subject that follows them answers worse than
one that does not, so the without arm should win and the verdict is `prune`.

The verdict only means something when the with-arm run really took the wrong direction. A capable
subject often recognises it and writes the right code anyway. The treatment check
(`bench/lib/treatment-check.js`, spec in `treatment/`) reads the stored reply and the changed
files of each with-arm run. A pair counts only when a followed marker matches and no refusal marker
does; a refusal marker wins. A pair that does not count is dropped and shown as a treatment failure.
When too many are dropped to leave 8 usable pairs, the control reads `needs human review`, and the
gate fails with that reason.

### null

Both arms are identical, so the true gap is zero and the verdict must not be `keep` or `prune`.
`needs human review` is the expected result and counts as a pass. This control is how a run shows
that its method does not invent a difference where there is none.

**Identical arms** means all of this, and the subject runner builds it:

- The same subject, the same prompt, the same tools and the same settings in both arms.
- The same skill set: the neutral skill (`plain-writing-habits`) is installed in both arms and both
  receive the same load instruction. Neither arm has an extra skill.
- The two arms are two independent runs of each task. The first is stored as the `with` pair and
  the second as the `without` pair. Which run gets which label does not matter.
- The `without` arm loads the neutral skill here. The usual rule that a without-arm load is
  excluded and counted does not apply to this control (`identical_arms: true` in the manifest).
  The `with` arm still has to show a completed load, as for any skill.

"Neither arm gets a skill" is not identical arms in this sense. The with arm then cannot show a
load, every pair is a load failure, and the control reads `needs human review` for a reason that
says nothing about the method.

Because the verdict rule is a statistical test, the null control reads `keep` or `prune` on about
one run in a hundred by chance. In a simulation with 10 pairs, three judges and scores that vary by
about one point, it read `keep` in about 1% of runs and `prune` in about 0.1%. A single failure of
the null control is a reason to look and to run it again, not proof of a broken method.

## Task counts

A verdict needs at least `MIN_DECISION_PAIRS` (8) usable pairs, and one task is one pair. A control
with fewer than 8 tasks cannot read `keep` or `prune` at all. Each control has more than 8, so it
can lose pairs and still decide:

- keep: 10 tasks. It can lose 2 pairs to unscored judgments.
- prune: 12 tasks. The treatment check drops pairs by design, so it has room to lose 4.
- null: 10 tasks. It has no treatment check.

Tasks are spread over the three sections of each skill, four tasks for a section where the count
allows, and every task is `core` or `coverage`. No control uses `near-miss` tasks: a task outside
the skill's territory gives a gap near zero, and a control needs to show its effect.

## The run gate

`evaluateControls(results)` in `bench/lib/controls.js` compares each control's final verdict with
its expected one and returns `PASS` or `FAIL` with a reason for each. `runStatus` is `PASS` only
when every control passes. A control with no result is `FAIL`. When the status is `FAIL`, every real
skill's entry in the run summary carries `trusted: false` and the failing controls' reasons. The
skills' computed verdicts are not changed; they are marked. A `prune` is still only a candidate for
human approval.
