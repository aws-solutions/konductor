# Clip delivery decision inputs

This directory is a small architecture review packet for the Northstar media platform. The platform stores short video clips at a neutral object-storage origin and needs a public delivery path for a new regional launch.

Start with `requirements.md` for the decision context, `traffic.json` for the workload shape, `price-sheet.json` for billing rules, and `performance.csv` for measured behavior. `operations.md` records the recovery expectations. The architecture notes explain the three IDs used throughout the packet.

The numbers describe a steady production month, not a one-off migration. Prices use decimal terabytes, where 1 TB is 1,000 GB. The price sheet's prose and data file are the source for billing arithmetic.

A previous pilot used a 120 TB monthly estimate, but that estimate is **superseded by the 180 TB production forecast** in `traffic.json` and `requirements.md`.
