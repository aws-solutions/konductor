# Recovery and operations targets

The checkout record is replicated to the secondary region. Recovery procedures are tested against a **60-second maximum RPO** and a **5-minute maximum RTO**. These are production commitments for a regional failure, not advisory goals.

| Measure | Limit | Review note |
| --- | ---: | --- |
| Recovery point objective | 60 seconds | Maximum committed data loss |
| Recovery time objective | 5 minutes | Maximum time before accepting traffic |
| On-call acknowledgement | 10 minutes | Informational, not a checkout hard limit |

The options file contains the measured recovery values for each architecture option. Use those values when checking the decision.