# System Design (platform)

Components:
- API Gateway (REST) with the shared AuthMiddleware (Cognito JWT validation, account scoping) used by every feature.
- Lambda handlers -> Business Facade -> Services -> Repositories (DynamoDB single table `platform`).
- MonitorService (owns monitors), ProbeScheduler (EventBridge Scheduler, one schedule per monitor), ProbeWorker (Lambda, performs HTTP probe),
  AlertService (publishes to per-account SNS topic), TagService (owned by tag-management feature).
- DynamoDB table `platform`: PK/SK single-table. Monitors: PK=ACCOUNT#<accountId>, SK=MONITOR#<monitorId>. GSI1 for name uniqueness: GSI1PK=ACCOUNT#<accountId>#NAME#<name>.
- Probe results: PK=MONITOR#<monitorId>, SK=RESULT#<timestamp>, TTL 7 days.
- Shared logging/metrics via Powertools.
