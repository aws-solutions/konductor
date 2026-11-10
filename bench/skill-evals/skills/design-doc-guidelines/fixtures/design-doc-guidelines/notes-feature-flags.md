Notes for the feature-flag service design (raw, from a meeting):
- pain: flags live in 4 different config files; turning one off in prod needs a deploy (~35 min). During the 2025-09-12 incident we waited 35 min to disable a broken checkout flag.
- want: central flag store, change takes effect in < 30 s, audit log of who changed what.
- approach: DynamoDB table for flags (PK=flagKey), SDK caches flags for 60 s and polls the API every 30 s; admin UI writes through an API with Cognito auth; every write emits an EventBridge event to an audit Lambda that writes to S3.
- SDK: TypeScript + Python. ETag/If-None-Match on the poll to save bandwidth.
- phases: (1) table + API + TS SDK, (2) admin UI + audit, (3) Python SDK + migrate the 4 config files.
- ask from approvers: agree that product teams can turn flags off in prod without a deploy, and that we retire the 4 config files by end of Q1.
