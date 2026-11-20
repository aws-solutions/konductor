# Note (June 2025): throttle by client IP

Proposal from the old platform team: limit every client IP address to 100 requests per minute at the load balancer.

Status: superseded. The 2026 request in `docs/product/rate-limits-request.md` replaced this with per-key limits,
because many customers share one office IP and the load balancer cannot see API keys.
