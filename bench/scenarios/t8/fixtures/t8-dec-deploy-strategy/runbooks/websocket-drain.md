# Websocket drain notes

A host in drain mode rejects new websocket assignments but keeps established sessions. The session router reports `drain_remaining` every 30 seconds. Do not kill a host merely because a normal drain takes longer than one polling interval.

Escalate when the p95 drain exceeds 40 minutes, when close codes change unexpectedly, or when a drained host continues receiving new assignments.
