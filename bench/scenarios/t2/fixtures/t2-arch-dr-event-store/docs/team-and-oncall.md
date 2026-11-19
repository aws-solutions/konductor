# Team and on-call notes

The order team has six engineers. Two have operated PostgreSQL at scale, three are comfortable with the current TypeScript service, and one has maintained the broker relay. No one on the primary rotation has run an event-store migration in production. The platform team can review infrastructure changes but cannot own an order-specific replay during an incident.

The rotation covers 08:00–22:00 local time every day, with a platform escalation overnight. The runbook convention is one command per recovery step, explicit success criteria, and a rollback or stop condition. On-call engineers use dashboards for API latency, database health, broker lag, and projection freshness.

The service has a monthly change budget of two database migrations and one planned maintenance window. The team prefers managed PostgreSQL and the existing broker because both are covered by the current pager and backup practices.
