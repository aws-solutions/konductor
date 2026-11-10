# Observability vendor for the Payments program

Owner: platform team

## Context

Our current setup is CloudWatch dashboards plus ad hoc log queries. On-call says it takes
too long to find the failing service during incidents (median 38 minutes to identify the
component in the last 6 SEV2s). Finance wants the decision in this quarter's budget.

## Options

| Option | Description | Pros | Cons | Effort | Risk |
| ------ | ----------- | ---- | ---- | ------ | ---- |
| A. Datadog | SaaS APM, logs, metrics | Fast setup, strong APM | List price $310k/year | S | Low |
| B. Grafana Cloud | Managed Grafana, Loki, Tempo, Mimir | Cheaper ($140k/year), open formats | Team has used Grafana only for dashboards | M | Medium |
| C. Self-hosted Prometheus + Grafana | Run it on our EKS clusters | | | L | High |

## Evaluation matrix

| Criteria | Weight | A. Datadog | B. Grafana Cloud | C. Self-hosted |
| -------- | ------ | ---------- | ---------------- | -------------- |
| Cost | 40% | 2 | 4 | 5 |
| Time to value | 30% | 5 | 4 | 2 |
| Scalability | 25% | 5 | 4 | 3 |
| Team capability | 15% | 4 | 4 | 2 |
| **Weighted total** | | **4.15** | **4.40** | **3.65** |

## Recommendation

Go with Datadog. It is the industry leader and everyone knows it.

## Decision record

Decided: yes. We will start the Datadog contract next month.
