# Operations notes

The scheduled worker runs at 02:15 UTC. The platform wrapper supplies credentials and the destination client. Local runs use the fake client in `src/fake-cloud-client.js`.

An export has a compact JSON object and a newline-delimited object. Both are stored below the date directory. The date is taken from the scheduler payload rather than from the host clock when the payload includes one.

Check `logs/` for a sample of the scheduler's structured output. Request identifiers are retained so a failed attempt can be correlated with platform logs.
