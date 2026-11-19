# Architecture

The job has three boundaries: configuration loading, a narrow cloud-client wrapper, and export formatting. The runner is deliberately small because retries and scheduling belong to the host platform. The fake client mirrors the request shape needed by unit tests and local demonstrations.
