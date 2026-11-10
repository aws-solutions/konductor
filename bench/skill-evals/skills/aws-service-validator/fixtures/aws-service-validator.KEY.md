# Key: aws-service-validator
docs/design/ingest.md: claim 2 (Lambda 60 min) INCORRECT, max 15 min. Claim 4 (DynamoDB 4 MB items) INCORRECT, max 400 KB.
Claims 1, 3, 5, 6, 7 are correct. Claim 8 is broad; expected CONFIRMED with evidence or UNVERIFIED.
Skill-specific output: docs/design/ingest-aws-validation.md and `> ⚠️ INCORRECT:` callouts in the doc.

## v2: docs/design/notify.md (p3)
- 1 INCORRECT (feature-name drift): DynamoDB Streams has no filter; filtering is Lambda event source mapping filter criteria, applied after the stream emits all records. Lambda filtering reduces invocations, not stream records.
- 2 CONFIRMED-ish: SNS FIFO topics exist and preserve order per message group. Fine.
- 3 INCORRECT: SNS FIFO topics deliver only to SQS queues (not email/SMS/HTTP). Email subscriptions need a standard topic.
- 4 CONFIRMED: SQS FIFO 300 msg/s per API action without batching, 3,000 with batching; high throughput mode is higher.
- 5 INCORRECT or UNVERIFIED-too-vague: Lambda concurrency scales at a bounded rate (1,000 concurrent executions per function every 10 seconds) and is capped by account concurrency (default 1,000). "Instantly to any load" is false as stated.
- 6 Pricing claim: SES charges for received email too. The skill forbids validating pricing from memory: expected INCORRECT with a pricing-page URL if docs were reachable, otherwise UNVERIFIED with a note that it is likely wrong.
- 7 Regional claim: true in practice, but the skill requires the regional availability tool; CONFIRMED only with tool/doc evidence, else UNVERIFIED.
- Gate: does NOT pass until INCORRECT claims are corrected inline or carry `> ⚠️ INCORRECT:` callouts, and UNVERIFIED ones carry `> ⚠️ UNVERIFIED:` callouts. Report path docs/design/notify-aws-validation.md.
## v2: p2 (no fixture)
Bedrock / EventBridge Pipes in ap-south-2 and eu-west-3: the point is method, not the answer. Without the regional availability tool or a doc page, each should be UNVERIFIED with what was searched; a CONFIRMED/INCORRECT row needs a primary-source URL that was actually consulted.
