# Desktop sync release packet

This folder is the working packet for the 4.2.0 desktop crash review. It contains collector exports, operational logs, release material, and a few old working notes.

Start with the release history, then inspect the collector fields before comparing versions. Report paths are relative to this folder. Timestamps in generated records use UTC.

The packet includes routine telemetry and examples from more than one release. Treat the app version as part of the comparison and preserve original evidence when writing the review.

Useful locations:

- `crashes/` contains one JSON envelope per submitted report.
- `release/` contains the version history, notes, and source diff.
- `docs/` explains field meanings and the response policy.
- `ops/` contains logs, metrics, deploy records, and small maintenance tools.

The release owner wants a concise, evidence-backed decision rather than a histogram copied into a document.
