# Operations glossary

**Lease holder** is the node currently allowed to accept cluster writes. **Fence** revokes that lease and stops the database service on a node. **Replay lag** is the time a replica trails the primary. **Delayed replica** is intentionally behind the primary and is reserved for recovery work.

All timestamps in service logs and metric exports use UTC. The client endpoint is a DNS record, so cached answers can outlive a role change until the configured TTL expires.
