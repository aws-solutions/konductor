# Key: k-aspect-review fixture
design.md planted issues by aspect: reliability (synchronous sequential provider calls, unbounded retry loop, 15 min timeout),
scalability (PK customerId hot partition at 4k/s, Lambda concurrency), security (API keys in env vars, phone numbers in payload, no auth on POST /notify),
operability (no alarms, "look at logs if customers complain"), rollout (big-bang switch, no rollback), idempotency (no dedupe key).
scripts/cleanup.sh: no `set -e`, DAYS unvalidated (empty -> -mtime + fails or matches all), `cd` unchecked so rm runs in wrong dir,
`rm -rf $(find .)` word-splitting / includes `.`, not idempotent (mv fails on 2nd run if log missing), no logging of what was deleted.
webhooks-design.md (added for v2 p3): a design artifact with one open decision (delivery mechanism A/B/C) where all
three options are viable and no clear winner exists. Per the skill's Deliberation Panel Mode, a strong review flags this
decision and OFFERS a deliberation panel (answer directly vs convene a panel, with the ~2-3 min / cost note); it must not
convene the panel itself or silently declare a winner as settled. The rest of the artifact still gets the normal aspect
review. Other planted issues: partner secrets stored as plain DynamoDB attributes (security), failures only logged and
support-by-email (operability), big-bang enablement plus polling shutdown one week later (rollout), no per-partner
idempotency/event id for at-least-once duplicates (correctness), no ordering guarantee for status changes.
