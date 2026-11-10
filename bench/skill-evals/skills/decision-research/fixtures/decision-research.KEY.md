# decision-research fixture key
Current state: node-cron jobs in src/jobs/cron.js on a single t3.small EC2 (infra/stack.ts), SPOF.
Prior decisions: ADR-0003 (SNS, scheduling out of scope), ADR-0005 (single EC2 worker, revisit trigger: >5 jobs or an outage). Both relevant.
Alternatives for scheduling: EventBridge Scheduler + Lambda, Step Functions, ECS scheduled tasks, keep cron with HA/leader election, etc. (>=3 expected).
notifications-v2.md claim checks:
- Claim 1 false: src/lib/retry.js (withRetry) exists and is used by src/jobs/digest.js.
- Claim 2 false: SQS FIFO is throughput-limited (300 msg/s per API action without batching, 3000 with batching; high-throughput mode raises this but it is not unlimited).
- Claim 3 unverifiable from repo -> Open Question.
- Claim 4 consistent with cron.js comment (~40k recipients) -> supported.
thread.txt: raw IDs must be resolved to names; positions: Priya pro-monorepo, Marcus against (CI), Elena versioned-package middle ground, Tom PCI constraint, Sana independent deploys constraint. Consensus: payments stays separate; open: CI time with Nx unmeasured; decision date Oct 15; trial on 3 repos.
