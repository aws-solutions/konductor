# Recovery and operations objectives

A lost session can force a user to sign in again, so the service may lose no more than 60 seconds of acknowledged session updates during a regional failure. The operations team has five minutes, or 300 seconds, to restore normal session-store service after declaring an incident.

These are service objectives for the selected database, not a promise that every dependent application recovers in the same interval. The architecture record should state which replication and restore assumptions support them.
