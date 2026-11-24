# Package architecture

The public entry point is `src/index.js`. It validates options and delegates queue state to `src/queue.js`. The implementation intentionally uses only Node built-ins and keeps failure observers outside the execution path.

The package has no worker process. A caller owns the queue and decides when the returned promises are awaited. The CI job runs the same node:test command used locally.
