# ParcelPing notification pipeline operations folder

This folder contains the day shift evidence for ParcelPing's delivery notification path. The path accepts delivery events through `notify-api`, puts them on `notify.events`, and fans them into three consumers before calling the push gateway.

The timestamps in logs and metrics are UTC. Configuration snippets show the values loaded by the service unless a document says that it is a change record. The scripts are small read-only helpers used during on-call work.

The incident window is mixed into a full day of ordinary traffic. Routine health checks, retry noise, and capacity warnings are intentionally retained so that the records can be compared across services.
