# Incident channel excerpt

All times UTC. Participants: Maya Chen (service), Ravi Mehta (database), Nora Ives (release), Jules Park (support).

**15:13 Maya:** Product page errors are back. I see the same short burst in the API and a full cache miss rate.

**15:15 Ravi:** The primary is at its 240 connection ceiling and read-1 is queuing requests. I am not changing the ceiling while the source of the burst is unclear.

**15:18 Nora:** The cache policy reload is the only cache change in this window.

**16:14 Maya:** Third burst has cleared. We need to stop another wave before it repeats.

**16:19 Maya:** I am applying a cache policy with 120 seconds of jitter and pausing the full warmup. The API refill backoff is also being enabled.

**16:22 Nora:** The policy update and API backoff are live. Keep the database ceiling unchanged and watch page errors, hit ratio, and waiters.

**16:27 Ravi:** Waiters are zero and read-1 lag is falling. The page path is healthy again.
