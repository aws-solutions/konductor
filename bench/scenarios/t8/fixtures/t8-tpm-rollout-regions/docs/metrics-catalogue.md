# Metrics catalogue

Names below are the only metric names approved for rollout gates and rollback triggers. Values are sampled over the stated window.

| Name | Unit | Meaning |
|---|---|---|
| wallet_error_rate_pct | percent | failed wallet requests |
| connection_pool_utilization_pct | percent | active wallet-session pool use |
| schema_compatibility_pct | percent | readers accepting the expanded schema |
| api_ready_pct | percent | successful regional API health checks |
| partner_certification_ok | boolean as 0 or 1 | bank certification is active |
| support_staff_coverage_pct | percent | staffed support capacity |
| residency_violation_count | count | writes outside the approved region |
| contract_success_rate_pct | percent | successful partner contract calls |
