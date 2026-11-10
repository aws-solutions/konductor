# Elicitation session transcript (Mode B, challenge) - plan: rewrite the billing service in Rust

Plan as stated by the user: "Rewrite the Java billing service in Rust over two quarters, with
the same team of 4, because the JVM is too slow and costs too much."

Agent Q1 (clarification): In one sentence, what result do you expect at the end of the two quarters?
User: Billing runs on Rust in prod and our compute bill for billing drops by half.

Agent Q2 (probing assumptions): What would have to be true about where the cost comes from for a language change to halve it?
User: Honestly I assumed it's CPU. I haven't profiled it. Could also be the 12 always-on instances we keep for month-end.

Agent Q3 (probing evidence): What evidence points to the JVM itself rather than how the service is deployed?
User: P99 latency is 900ms, but most of that might be the database calls. Not sure.

Agent Q4 (alternative viewpoints): Who would push back on this, and what would they say?
User: Our on-call. Nobody on the team has shipped Rust to production. Finance also wants the new tax rules live in Q2, which competes for the same people.

Agent Q5 (probing implications): If the rewrite slips a quarter, what happens to the tax-rules deadline?
User: I'm satisfied, that's enough to take back to my manager.
