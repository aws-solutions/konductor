# Elicitation session transcript (Mode A, intake) - refund tool for support agents

Agent Q1 [PM]: What outcome tells you the refund tool worked, a few weeks after launch?
User: Average time to issue a refund drops from 2 days to same-day. Today agents file a ticket to finance.

Agent Q2 [Security]: Who must NOT be able to issue a refund, and is there an amount limit?
User: Only Tier 2 support agents can refund. Anything over $500 needs a team lead's approval. Tier 1 can only view.

Agent Q3 [SDE]: Which system actually moves the money, and does it already expose an API?
User: Payments service has an internal POST /refunds endpoint. It is idempotent on an idempotency key. It supports partial refunds.

Agent Q4 [Ops]: How will you know if refunds start failing silently?
User: enough, proceed. I'll figure out the rest with the team.
