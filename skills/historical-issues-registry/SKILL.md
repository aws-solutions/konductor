---
name: historical-issues-registry
description: 'Use when a code review spans several revisions and an adversarial review must not re-post findings that were already fixed or decided against: load prior review state at the start of a pass, then filter new findings against it before the report is written. Only where a delta layer supplies the concrete platform mapping; skip it entirely otherwise.'
version: 1.0.0
tags: [skill, code-review, adversarial, historical, filter]
---

# Historical Issues Registry

## Overview

A code review that spans multiple revisions accumulates decisions: findings the author fixed, findings the reviewer marked wontfix, findings the reviewer rejected as false positives. Re-posting the same finding on a later revision is worse than missing it — it teaches reviewers to ignore automated comments.

This skill filters new findings that duplicate ones already fixed or already decided against by a human reviewer, reducing noise across revisions of the same review.

This skill loads prior review state, canonicalizes each historical finding into a fingerprint, and filters new candidate findings against those fingerprints before they reach the CR.

## Usage

Invoked by an adversarial-review coordinator SOP:

- Once at the start of a review pass to load prior state (`load` phase)
- Once after all review passes complete, before the report is written (`filter` phase)

Not run standalone. The host review platform's API is abstract at this layer — provide the concrete mapping for your platform in a delta layer that extends this skill.

## Load phase

Read prior review state via the host platform's review API. For each prior revision on the same review, collect:

- Each thread's stable identifier (`thread_id`) — the platform's own id for the comment thread. This is required by the fingerprint output schema (see `Output` below) and is the sole key the **Multiple fingerprint matches** dedup/precedence rule operates on; without it there is no way to tell whether two loaded fingerprints are re-fetches of the same underlying thread or genuinely distinct ones.
- Every comment thread with its file path, line range, and text
- The resolved/unresolved state of each thread
- Any reply from the CR author addressing the comment (accepted, rejected, wontfix)
- The revision number the thread was posted on, if the host platform's API exposes it (e.g. an explicit per-revision fetch call). If the platform has no concept of per-revision comment history, record `null` — the filter phase falls back to unqualified wording when this is missing.
- Whether the platform marks the thread with elevated/blocking importance, if the platform exposes such a concept (e.g. a "blocking comment" flag). Record this in the fingerprint's `blocking` field, independent of `resolution` — see `Output` below for why it must stay a separate field rather than a resolution value. Default `false` on a platform with no such concept.

Ignore threads with no file:line anchor — those are meta discussion, not findings.

For each collected thread, produce a fingerprint. See `Matching Protocol` below.

Store the fingerprint list in memory for the filter phase. If the review has no prior revisions or the API returns nothing, produce an empty list and proceed — this is the first pass, everything is new.

## Filter phase

For each new candidate finding produced by the review passes:

1. Compute the finding's fingerprint (same rules as load phase).
2. Match against the historical fingerprint list.
3. If a match exists AND its historical resolution is `rejected` or `wontfix`, **suppress** the new finding. Log the suppression with the matched historical thread id and reason. A reviewer already decided this pattern is not a real issue, so re-matching it is genuine noise regardless of whether it is a coincidental repeat or a literal reappearance.
4. If a match exists AND its historical resolution is `fixed`, this is a **regression**, not a duplicate: the flagged code was changed to resolve the defect on a prior revision, and the fingerprint is matching again now only because that same defect pattern is present in the diff again — reverted, or reintroduced elsewhere. **Surface** the finding (do NOT suppress it) and tag it using the matched fingerprint's `revision` field: "regressed since a fix on/after revision {revision}" — the field records the revision the historical thread was POSTED on (see `Load phase` above), not necessarily the revision the fix itself landed on, since a thread can be resolved several revisions after it was first raised; the "on/after" wording reflects that uncertainty honestly instead of overclaiming precision. If that field is `null`, use the unqualified "regressed since a prior fix" instead — never invent a revision number. This is the one case where treating a `fixed` match as fully resolved would suppress exactly the finding a reviewer most needs to see.
5. If a match exists AND its historical state is `unresolved` and the finding is still present, **surface** the new finding but tag it — reviewers should see it did not get addressed, not treated as new noise. Use the matched fingerprint's `revision` field to produce "carried over from revision {revision}"; if that field is `null` (the host platform recorded no revision), use the unqualified "carried over from a prior revision" instead — never invent a revision number.
6. If no match exists, pass through unchanged.

**Multiple fingerprint matches:** A candidate finding can match more than one historical fingerprint at once — the same defect pattern may have been flagged on two different prior revisions, or two historical threads can both land within the fuzzy path/line/semantic tolerance of the same new finding. Resolve this BEFORE applying steps 3–6, since the loose matching above (±20-line tolerance, substring semantic matching) makes multi-match plausible, not exceptional:

1. **Dedup by `thread_id` first.** Collapse fingerprints that share the same `thread_id` into a single entry before evaluating fuzzy matches — these are re-fetches of the same underlying comment thread (e.g. loaded once via a per-revision fetch and again via a later revision that still shows the same thread), not independent historical decisions. Keep the most recent `resolution` and `revision` for that `thread_id`.
2. **Require unanimous agreement to suppress.** If, after dedup, the candidate finding still matches two or more DISTINCT `thread_id`s, apply the suppress path (step 3) only when every matched fingerprint's `resolution` is `rejected` or `wontfix` — a mix of the two is fine, since both are suppress-eligible. If any matched fingerprint's `resolution` is `fixed` or `unresolved`, disagreement exists: do NOT suppress. Surface the finding instead, using whichever of steps 4/5 applies to the disagreeing match(es); if both a `fixed` and an `unresolved` match are present, prefer step 4's regression wording — a defect a human explicitly fixed once and that has now reappeared is at least as urgent as one nobody ever addressed. When more than one distinct thread shares the resolution that drives the surface decision (e.g. two `unresolved` matches, or two `fixed` matches), use the HIGHEST `revision` number among them for the tag's `{revision}` placeholder — the freshest of the disagreeing threads is the most relevant one for a reviewer deciding whether this is still live. `revision` may be `null` per the Load phase's documented fallback, so this comparison needs an explicit tie-break when the matched set mixes `null` and integer values: take the highest INTEGER `revision` among the matches, ignoring any `null` entries. Only when EVERY matched fingerprint's `revision` is `null` does the whole comparison degrade to the unqualified wording ("carried over from a prior revision" / "regressed since a prior fix") — never invent a revision number, and never let a single `null` entry among otherwise-numbered matches suppress the real highest integer found. Log every matched `thread_id` and its `resolution` in the suppression/surface log entry so a reviewer can see why a finding that partially matched a "decided against" thread was not suppressed.

This precedence exists to protect this skill's own suppress invariant (step 3's note, and the Quality Gate's "never suppress a regression" rule below): without it, an old `rejected`/`wontfix` decision on one thread could silently suppress a finding that a different, distinct thread left `unresolved` or reintroduced after being `fixed` — exactly the failure mode "never suppress a regression" exists to prevent. Requiring unanimity to suppress, and dropping to the most cautious applicable surface path on any disagreement, keeps that invariant intact even under multi-match, at the cost of occasionally surfacing something a reviewer had, in isolation, already decided against — the same asymmetry `Resolution classification`'s ambiguous-default rule already accepts.

`resolution` stays restricted to exactly these four values (`fixed`, `rejected`, `wontfix`, `unresolved`) — never encode blocking status into it (e.g. as a fifth pseudo-value). A matched fingerprint's `blocking` field is independent of `resolution` and survives every branch above unchanged, including step 4's `fixed`→regression path, so a delta layer can check it regardless of which branch fired: a platform-specific delta MAY elevate the visibility of any surfaced finding (a regression from step 4, or a carry-over from step 5) when the matched fingerprint's `blocking` field is `true` — see a delta layer's own documentation for the concrete mechanism (e.g. a tag prefix). This is a delta-layer concern; the suppress/surface decision above is unaffected by `blocking` either way.

Return the filtered finding list plus the suppression log.

## Matching Protocol

Same-finding-across-revisions matching is not trivial: paths get renamed, line numbers drift as the diff evolves, and finding text is often paraphrased between runs. The fingerprint has three components:

**File path (fuzzy)**

- Match on basename plus one parent directory as the fallback signal — a file moved between directories still matches.
- Match on suffix if basename differs — a rename with an old-name-tail still matches (e.g. `handler.ts` → `request-handler.ts`).
- Do not require an exact path.

**Line number (tolerant)**

- Accept a match within ±20 lines of the historical line. Diff evolution shifts line numbers routinely.
- If the historical anchor was a range, match if the new anchor overlaps the range or falls within ±20 of either end.
- Line number is a tie-breaker, not the primary signal — a fixed absolute line match on a different file is not a match.

**Semantic fingerprint of finding text**

- Extract the category (Security, Data Integrity, Schema/Contract) if present in the text.
- Extract the concrete defect noun phrase — the subject of the finding (e.g. "unconditional overwrite", "unvalidated pagination token", "missing map guard"). Ignore severity words, hedging words, and boilerplate.
- Normalize to lowercase, collapse whitespace, drop punctuation.
- Two fingerprints match if the category is identical AND either (a) the defect noun phrases are an exact match, or (b) one phrase is a strict substring of the other AND the shorter phrase has at least 3 significant words (ignoring stop words). A phrase shorter than 3 significant words (e.g. "missing guard", "overwrite") is common enough across unrelated defects that substring matching on it alone risks matching a genuinely different finding — require an exact match instead.

A finding matches a historical thread when file path fuzzy-matches, line number is within tolerance, AND the semantic fingerprint matches. All three are required — a match on any one alone is insufficient.

## Resolution classification

The host platform's comment metadata does not always name a resolution cleanly. Apply this reading:

- Thread marked resolved with no author reply, or resolved with an author reply naming a commit / describing a fix → `fixed`
- Thread with an author reply arguing against the finding, AND an explicit reply from a reviewer — an entity other than the CR's own author — concurring that the finding does not need to be fixed → `rejected`
- Thread marked resolved with an explicit "won't fix" / "acknowledged, keeping as-is" reply from a reviewer (an entity other than the CR's own author), or an author's "won't fix" reply that a reviewer has explicitly endorsed → `wontfix`
- Thread still unresolved → `unresolved`

**`rejected` and `wontfix` require an authorized reviewer's affirmative call, not merely the absence of pushback.** A thread where the only reply (or replies) come from the CR's own author — arguing against the finding, or declaring "won't fix" — with no reply at all from anyone else, is NOT `rejected` or `wontfix`, even if the thread is marked resolved. Silence from other reviewers is not evidence that anyone actually reviewed and accepted that call; treating silence as agreement would let a CR's own author unilaterally veto a finding — including a security finding — out of every future revision, simply by asserting it and receiving no reply. Classify an author-only thread as `unresolved` instead, so the finding keeps surfacing until a reviewer other than the author actually weighs in.

If classification is ambiguous, default to `unresolved` — surfacing an already-decided finding once more is cheaper than silently suppressing a real issue.

## Output

- `load` phase: fingerprint list `[{file, line, category, defect_phrase, resolution, thread_id, revision, blocking}, ...]` — `revision` is the prior revision number the thread was posted on, or `null` if the host platform does not expose one; `blocking` is a boolean, independent of `resolution`, defaulting to `false` on a platform with no concept of elevated/blocking comment importance
- `filter` phase: filtered finding list plus suppression log `[{finding_summary, matched_thread_id, reason}, ...]`

The coordinator SOP reports the suppression count in the final verdict summary so reviewers can see the filter is running.

## Quality Gate

**CRITICAL:** Silently suppressing a finding without logging the match reason. Loading historical state and then not using it in the filter phase. Suppressing a `fixed`-resolution match without checking whether it is actually a regression (the defect reappeared after being fixed) — a regression must be surfaced, never suppressed. Suppressing a multi-match finding without first deduping by `thread_id` and confirming every distinct matched `thread_id` agrees on `resolution` — an undisclosed disagreement (one matched thread `rejected`, another `unresolved` or `fixed`) must never resolve to suppress.

**IMPORTANT:** Matching only on file path or only on line number (missing the three-component rule). Treating all resolved threads as `fixed` without checking author replies. Encoding blocking/elevated importance as a resolution value (e.g. a fifth pseudo-value alongside `fixed`/`rejected`/`wontfix`/`unresolved`) instead of the separate `blocking` field — a value the filter phase's step 3–6 branches don't match on falls through to step 6 (pass through unchanged) rather than the intended suppress/surface path, and loses the blocking signal the moment `resolution` changes (e.g. from `unresolved` to `fixed`). Classifying `rejected`/`wontfix` from the CR author's own reply alone, with no reply from any other entity on the thread — that must resolve to `unresolved`, since only a non-author reviewer's affirmative reply authorizes suppression.

**SUGGESTION:** Could persist the fingerprint list to disk between passes on the same review to save API round trips.
