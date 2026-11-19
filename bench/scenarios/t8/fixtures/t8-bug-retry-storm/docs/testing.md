# Testing notes

The visible suite uses only Node's built-in test runner and assertions. Client tests use a synchronous timer seam for cases that do not inspect elapsed time. Keep transport calls deterministic and do not call a real endpoint from tests.
