---
name: historical-issues-registry
description: 'Invoke from an adversarial-review coordinator SOP, but only where a delta layer supplies the concrete platform mapping: load prior review state at the start of a review pass, then filter new findings against it after all passes complete, before the report is written. Not run standalone, and skip entirely on a platform with no such delta layer.'
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

- Each thread's stable identifier (`thread_id`) — the platform's own id for the comment thread. This is required by the fingerprint output schema (see `Output` below) and is the sole key the **Multiple fingerprint matches** dedup/precedence rule (in `references/multi-match-precedence.md`) operates on; without it there is no way to tell whether two loaded fingerprints are re-fetches of the same underlying thread or genuinely distinct ones.
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

Open `references/multi-match-precedence.md` (relative to this file) when a candidate matches two or more historical threads, and resolve that before applying steps 3-6. It also holds the rule that `resolution` keeps exactly four values and `blocking` stays a separate field.

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
