# Operations notes

The platform team will keep the service within one regional connection-pool budget. A design that needs more than 1,000 logical database connections or pools cannot be operated by this service, even if its individual database files are small. The tenant count is 12,000, so the number of logical databases is an operational concern rather than a bookkeeping detail.

Recovery objectives for production are:

| Objective | Limit |
| --- | ---: |
| Recovery point objective | no more than 60 seconds of acknowledged writes |
| Recovery time objective | no more than 15 minutes |

The shared deployment takes a replicated snapshot every 30 seconds and is expected to restore in 10 minutes. A per-customer file deployment has a 45-second replication point and a 12-minute restore estimate in the platform worksheet. These estimates are inputs for comparing options, not a decision.
