# Architecture notes

The API is a small request adapter around an object store and a key-value metadata table. Object names begin with a workspace directory, while table records use the workspace id as their partition key.

A request enters through `src/request-context.js`. The adapter verifies the signed request envelope, adds the workspace details to an immutable context object, and passes that context to the storage layer. The storage layer does not construct credentials or make authorization decisions.

The deployment keeps data for all workspaces in one bucket and one table. This reduces infrastructure churn but means path and key handling must stay consistent across readers, writers, and background jobs.
