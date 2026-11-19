# Operations notes

The process has no HTTP listener. An embedding process creates an application, adds jobs through the API facade, and calls `run` for a known instant. A supervisor can call the worker on a fixed polling interval.

The outbox uses one file per application directory. Keep the directory on a local filesystem and hand records to the sender in batches.
