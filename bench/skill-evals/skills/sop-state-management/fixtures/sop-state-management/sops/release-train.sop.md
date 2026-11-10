# Release train SOP

Phases: build, test, docs, deploy. Workers for the test phase run in parallel, one per service,
and each calls `bump_counter(path, "fix_cycles_used")` when it retries a failing test.

State is kept with `tools/session_state.py`. On start, call `discover()`; if it returns a session,
continue from the first phase that is not COMPLETED or SKIPPED, otherwise `mint()` a new one.
