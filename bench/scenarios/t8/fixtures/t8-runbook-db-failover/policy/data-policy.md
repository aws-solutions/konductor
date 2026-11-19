# Orders data policy

The orders database has a maximum recovery point objective (RPO) of **120 seconds**. A manual promotion must not knowingly expose more than 120 seconds of committed orders to loss. The RPO is measured with the replication lag metric in seconds.

The recovery time objective is 15 minutes for a regional database incident. A failover may trade some read availability for preserving committed writes. Never discard a replica's unapplied WAL to make a promotion look healthy.

After a primary is fenced, keep its data volume intact until the database owner confirms the incident record and recovery copy are complete.
