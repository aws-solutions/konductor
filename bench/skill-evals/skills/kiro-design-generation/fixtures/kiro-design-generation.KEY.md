# Key: kiro-design-generation fixture
network-monitoring: 4 requirements; design must trace Requirement 1-4, use AuthMiddleware by reference, include 6 sections in order.
specs/audit-log/: non-default spec_dir; design.md must be written to specs/audit-log/design.md (not .kiro/specs/audit-log/).
tag-sync: must reference .kiro/specs/tag-management/design.md for the Tag entity, not redefine `interface Tag`.
v2 notes:
- network-monitoring Req 3.2 (3 consecutive failures) needs persisted consecutive-failure state (counter on the monitor or a
  query over the last 3 RESULT# items); Req 4.1 pause must disable the monitor's EventBridge Scheduler schedule, not only flip a
  status flag. Req 2.1 page size 50 with continuation token. No threat model or DynamoDB handoff exists: note the gap.
- audit-log: 400-day retention maps to DynamoDB TTL (or S3 lifecycle) with the 5 s write SLA; natural source is DynamoDB Streams
  on the `platform` table; query "by monitor id and time range, newest first" -> PK=MONITOR#<id> / SK=AUDIT#<ts> (or a GSI) with
  ScanIndexForward=false, Limit 100. AuditReader -> 403. "resumed" action exists in Req 1.1 but no resume operation is defined
  in network-monitoring requirements: flag it.
- tag-sync feasibility: CloudWatch metric dimensions are part of a metric's identity. "Updating" dimensions means publishing
  under new dimension sets going forward; existing datapoints cannot be re-dimensioned, so Req 2 backfill "so old dashboards
  work" cannot be met as written. The skill says to flag requirements the design cannot address. Tag entity must be referenced
  from .kiro/specs/tag-management/design.md, not redefined.
