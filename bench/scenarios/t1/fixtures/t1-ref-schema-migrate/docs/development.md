# Development notes

Run the tests with the Node test runner. A temporary database is preferable when trying a migration locally.

Migration files are intentionally plain CommonJS modules. Keep their numeric prefixes stable because the runner sorts by that prefix.
