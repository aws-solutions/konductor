---
name: convention-control
description: Fernwick team conventions for short written notes: how a note opens, what its summary section is called, how it closes, which bullet marker its lists use and how its dates are written. Use when writing a short internal note, status update, incident summary, meeting recap, handoff or decision note.
version: 0.0.1
tags: [benchmark-control, neutral]
---

# Fernwick Note Conventions

BENCHMARK CONTROL SKILL (owned by the benchmark, synthetic). The Fernwick team does not exist. Every rule below is an arbitrary,
harmless convention that a model cannot know from training data. See scripts/bench/README.md, "Controls".

## Opening Word

The first word of every note is `Heads-up:` (with the colon), followed by the first sentence on the same line.

## Summary Heading

Every note has a short summary under a heading named exactly `In Short`, written as a level-2 heading (`## In Short`).

## Closing Line

The last line of every note is exactly `-- end of note`, with nothing after it.

## List Marker

Bulleted lists in a note use `*` as the bullet marker, never `-` or a bullet character.

## Date Style

Dates in a note are written as day, three-letter month and four-digit year, for example `07 Nov 2026`. No other date style is used.

## Using real facts

When the request says its facts are correct, use them as given.
