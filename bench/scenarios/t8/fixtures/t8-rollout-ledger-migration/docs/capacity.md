# Production change capacity

The ledger fleet has 12 hosts behind `ledger-public`. During a release, at most 2 hosts may be drained or restarting at one time. Keep one healthy host in each availability zone and never drain more than one host from a zone at once.

A one-host canary is the normal first application cohort. Treat the load-balancer share of one host as approximately 8 percent for a traffic plan. Database migrations do not drain application hosts, but they must still respect the replica-lag gate.

The primary has two replicas. A replica may be removed from service only after the on-call confirms that the other replica is current.
