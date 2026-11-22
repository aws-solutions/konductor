# Workspace on-call standard

The workspace service is covered by the shared product on-call rotation during business hours and by the platform rotation overnight. A worker queue is an operational dependency when it can delay a user-visible action.

The owner must alert on an email queue age above 5 minutes for 10 consecutive minutes, a terminal-failure rate above 1% in a 15-minute window, or a provider timeout rate above 5% in a 15-minute window. Each alert needs a runbook link describing the first checks, the safe retry action, and the customer update path.

A dashboard panel alone is not an alert. The worker emits queue age, attempt count, provider response class, and terminal state metrics with the `workspace_invite` event type.
