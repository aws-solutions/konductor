# Restart triage

1. Check the container lifecycle record and the node-agent memory reading.
2. Compare restart counts with request and error counts for the same five-minute windows.
3. Check the deploy record and configuration changes in effect before the first restart.
4. Keep one healthy version or canary in the comparison when possible.
5. Record the recovery change and confirm a full traffic interval after it.

The gateway's retry budget is four seconds. A failed upstream request is counted once in the API error metric even if the gateway retries it.
