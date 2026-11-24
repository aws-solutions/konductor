# Northstar Reporting Operations

This folder contains the working records for the Northstar nightly reporting job. The job loads warehouse rows, removes duplicates, adds lookup attributes, aggregates the result, and publishes a report for downstream teams.

The useful material is split between the UTC job logs, input-volume history, service metrics, configuration history, deploy history, and the short runbook pages. Some files contain routine service traffic mixed with the batch records. Keep input files unchanged while preparing an analysis.

The reporting owner is the Operations Analytics team. The normal run begins overnight and the output is consumed by finance and planning after the run completes. Historical files use UTC unless a field says otherwise.
