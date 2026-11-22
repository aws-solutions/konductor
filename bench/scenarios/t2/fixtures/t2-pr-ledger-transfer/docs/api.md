# API notes

Transfer amounts arrive as strings such as `12.50` and are validated against the configured currency scale before storage. The public API returns a transfer id and the resulting integer balance.

Account ids use the `acct_` prefix in examples. Client keys use the `client_` prefix and should be stable across retries.
