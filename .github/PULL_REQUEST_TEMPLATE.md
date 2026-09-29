# Skill Benchmarking Framework — Design

## What

- Design doc for a monthly skill evaluation framework that identifies redundant/trimmable skills via a council of models (including Opus)
- PE review report showing 9.6/10 confidence score, PE-READY verdict, 0 CRITICAL/IMPORTANT findings
- Session state tracking YAML

## Why

- Konductor ships 82 skills under `skills/`. Nothing measures whether a skill earns its token cost.
- Three concrete gaps: no redundancy signal, no trigger-quality signal, no cost signal.
- Replaces existing benchmark harness under `tests/`.

## How

- Configurable cadence (monthly/bi-monthly/ad-hoc via `--frequency` flag)
- Council voting per skill (keep/trim/delete) — majority required for action
- Output: human-readable report + machine-readable implementation plan
- Parameterized `corpus_path` for flexible corpus targeting

## Testing

- Maker-checker passed (0 CRITICAL, 0 IMPORTANT)
- PE review passed (9.6/10 confidence, PE-READY)
- Adversarial loop: 4 rounds, all CRITICAL/IMPORTANT findings fixed
