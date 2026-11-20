# Decision 003: structured log fields

**Status:** accepted

Every job log includes `jobId`, `queue`, `attempt`, and `durationMs`. Messages remain short so the log stream can be searched during a busy ferry arrival.
