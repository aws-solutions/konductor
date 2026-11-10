# Notes from the Tuesday payments outage

I was on call. The first page came in at 02:14 and I didn't get the dashboard to load until 02:31, which is its own problem.

The root cause was boring: a cert on the ledger proxy expired. We had a reminder ticket for it in Pivotal Tracker, assigned to me, due the Friday before. I snoozed it.

The vendor's status page said their gateway was "seamless and robust under all conditions, no action needed." It was not. Their client retried every failed handshake 5 times with no backoff, so our proxy logs grew 40 GB in an hour and the disk filled at 03:02.

Additionally, our runbook told me to restart the proxy. That made it worse, because the restart reloaded the same expired cert.

What I'd change: cert expiry alerts at 30 and 7 days, a backoff cap on the vendor client, and a runbook line that says check the cert first. I'm also done snoozing tickets — at least that kind.
