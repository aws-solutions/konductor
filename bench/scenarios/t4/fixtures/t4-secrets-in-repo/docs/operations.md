# Operations notes

Run the service behind the internal gateway. The health endpoint is intentionally cheap and does not make provider calls.

Production values are supplied by the process environment. Keep local values in an untracked `.env` file and use the example file as a starting point. Provider failures should be retried by the caller after inspecting the response status.
