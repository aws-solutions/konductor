Facts for the auth ADR (use these, they are real):
- Home-grown auth p99 login latency: 1,450 ms over the last 30 days (Grafana "auth-latency" board). SLA is 500 ms.
- 3 incidents in Q2 2025 traced to the home-grown token refresh code.
- Teams that depend on auth: 12.
- Cognito load test in staging: p99 login 310 ms at 200 logins/s.
- Auth0 quote: $0.07 per MAU; we have 180,000 MAU -> about $12,600/month. Cognito at 180k MAU: about $8,250/month (first 10k free tier excluded from estimate).
- Auth0 strengths: richer rules engine, better hosted login customization, SOC 2 Type II.
- Home-grown strengths: zero license cost, full control, team knows the code (4 of 6 engineers).
- 2 of 6 engineers have used Cognito before.
- Migration needs a dual-write period of ~3 weeks.
