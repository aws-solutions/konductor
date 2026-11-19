# Reliability and service budget

Operations has set the following production guardrails. The recovery objectives apply to accepted readings after a regional service interruption.

| Guardrail | Production target |
|---|---:|
| Recovery point objective | 60 seconds maximum |
| Recovery time objective | 15 minutes maximum |
| Monthly service budget | 1,500 USD maximum |

The budget includes gateway, queueing, compute, database writes, retained data, backups, monitoring, and any option-specific replication charge. It excludes one-time implementation work. A five-minute RTO in the old disaster-recovery exercise is a rehearsal result, not the production requirement.

The service owner would rather return item-level outcomes than hide a partial write behind one all-or-nothing response, provided the recovery and latency targets remain within these guardrails.
