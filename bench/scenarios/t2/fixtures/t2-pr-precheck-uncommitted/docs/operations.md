# Operations notes

Production uses the endpoint in `config/production.json`. The sandbox endpoint is safe for local development and CI only. Credentials in the checked-in configuration are test values and are not accepted by a live carrier.

The quote cache is process-local. Restarting the service clears it. Cache entries use a short TTL because carrier rates may change during the day.
