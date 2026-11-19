# Testing locally

Tests create an HTTP server on the loopback interface and close it in their
cleanup path. Run the suite with `npm test`. The format check is intentionally
small because this package has no build step.
