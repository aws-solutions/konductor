# Dispatch pipeline architecture exercise

This repository contains the source material for an architecture decision. The system under discussion accepts notification messages and routes them to regional delivery workers. Keep the decision focused on the production path; sandbox figures are included only where the source labels them.

Start with `requirements.md`, `traffic.csv`, and `service-limits.md`. The price sheet is split between `pricing-notes.md` and `price-sheet.json`. The three candidate designs and their measurable assumptions are in `options.json`.

The existing platform has no requirement that every candidate use the same number of workers. Worker counts are sizing inputs, not service quotas. A design must explain how it handles the busy-hour rate and the recovery targets in the source material.
