# Decision 002: bounded shutdown

**Status:** accepted

Shutdown stops intake immediately and gives active handlers 4 seconds to finish. The broker connection closes after that window, and unfinished leases remain eligible for another worker.
