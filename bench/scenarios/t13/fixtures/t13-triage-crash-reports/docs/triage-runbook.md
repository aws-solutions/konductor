# Crash review runbook

Compare release versions before calling a group a regression. Count report envelopes and distinct user hashes separately. Keep platform counts in the same group so a platform-specific pattern does not become a second defect merely because symbols differ.

Use the source diff to identify a plausible suspect only after matching the behavior in frames or logs. Keep unrelated release changes as alternatives until the evidence rules them out.

The final review belongs in `triage/4.2.0-crash-triage.md` and must retain file-and-line citations.
