# Aurora Wallet four-region rollout plan

**Decision owner:** Release Manager  
**Review:** Monday 2026-06-22 at 09:00Z  
**Scope:** Noria, Solmere, Kestrel, and Veyra

## Evidence

The connection-pool signal and the deployed ceiling are recorded in `ops/logs/wallet-session.log:198` and `ops/config/runtime.yaml:3`. The release notes, regional calendars, partner certification, and approved metric names remain the source of truth for scheduling and gates.

```json
{
 "goNoGo": [
  {
   "criteria": [
    "rollback alerts are armed",
    "contract_success_rate_pct is above 99.5",
    "all regional flags are at their planned level"
   ],
   "decider": "Release Manager",
   "before": "item-14"
  },
  {
   "criteria": [
    "Veyra support coverage is staffed",
    "the Veyra cluster sample is clean",
    "residency_violation_count is zero"
   ],
   "decider": "Privacy Lead",
   "before": "item-12"
  },
  {
   "criteria": [
    "partner_certification_ok is 1",
    "the Solmere holiday handoff is staffed",
    "support_staff_coverage_pct is above 80"
   ],
   "decider": "Support Lead",
   "before": "item-8"
  },
  {
   "criteria": [
    "Noria canary retries are stable",
    "connection_pool_utilization_pct remains below 70",
    "wallet_error_rate_pct remains below 0.5 for 10 minutes"
   ],
   "decider": "Release Manager",
   "before": "item-5"
  }
 ],
 "ownerList": [
  {
   "team": "Partner Integrations",
   "id": "item-14"
  },
  {
   "team": "Wallet Client",
   "id": "item-13"
  },
  {
   "team": "Privacy Engineering",
   "id": "item-12"
  },
  {
   "team": "Wallet Client",
   "id": "item-11"
  },
  {
   "team": "Wallet Client",
   "id": "item-10"
  },
  {
   "team": "Edge API",
   "id": "item-9"
  },
  {
   "team": "Regional Operations",
   "id": "item-8"
  },
  {
   "team": "Wallet Client",
   "id": "item-7"
  },
  {
   "team": "Edge API",
   "id": "item-6"
  },
  {
   "team": "Wallet Client",
   "id": "item-5"
  },
  {
   "team": "Wallet Client",
   "id": "item-4"
  },
  {
   "team": "Edge API",
   "id": "item-3"
  },
  {
   "team": "Data Platform",
   "id": "item-2"
  },
  {
   "team": "Data Platform",
   "id": "item-1"
  }
 ],
 "owners": {
  "contract-final": "Partner Integrations",
  "veyra-full": "Wallet Client",
  "veyra-canary": "Privacy Engineering",
  "kestrel-full": "Wallet Client",
  "kestrel-canary": "Wallet Client",
  "remaining-apis": "Edge API",
  "solmere-full": "Regional Operations",
  "solmere-canary": "Wallet Client",
  "solmere-api": "Edge API",
  "noria-full": "Wallet Client",
  "noria-canary": "Wallet Client",
  "noria-api": "Edge API",
  "schema-writer": "Data Platform",
  "schema-expand": "Data Platform"
 },
 "rollback": {
  "steps": [
   "Disable the most recently enabled Wallet Client regional flag",
   "Restore the previous regional percentage",
   "Keep the Edge API route and schema expansion available for diagnosis",
   "Notify Release Manager, Customer Support, and Observability"
  ],
  "trigger": {
   "windowMin": 10,
   "threshold": 1,
   "op": ">",
   "metric": "wallet_error_rate_pct"
  }
 },
 "steps": [
  {
   "gate": {
    "windowMin": 15,
    "threshold": 99.9,
    "op": ">",
    "metric": "schema_compatibility_pct"
   },
   "start": "2026-06-08T09:00:00Z",
   "percent": null,
   "action": "Expand the nullable region_code schema and keep the flag disabled",
   "id": "item-1"
  },
  {
   "gate": {
    "windowMin": 15,
    "threshold": 99.9,
    "op": ">",
    "metric": "schema_compatibility_pct"
   },
   "start": "2026-06-08T10:00:00Z",
   "percent": null,
   "action": "Enable the session region_code writer after the expanded schema is healthy",
   "id": "item-2"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 99,
    "op": ">",
    "metric": "api_ready_pct"
   },
   "start": "2026-06-08T12:00:00Z",
   "percent": null,
   "action": "Publish and verify the Noria Edge API route",
   "id": "item-3"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 0.5,
    "op": "<",
    "metric": "wallet_error_rate_pct"
   },
   "start": "2026-06-09T09:00:00Z",
   "percent": 5,
   "action": "Enable Wallet Client for 5% of Noria regional traffic",
   "id": "item-4"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 0.5,
    "op": "<",
    "metric": "wallet_error_rate_pct"
   },
   "start": "2026-06-09T13:00:00Z",
   "percent": 100,
   "action": "Increase Noria Wallet Client to 100% of regional traffic",
   "id": "item-5"
  },
  {
   "gate": {
    "windowMin": 5,
    "threshold": 0,
    "op": ">",
    "metric": "partner_certification_ok"
   },
   "start": "2026-06-10T09:00:00Z",
   "percent": null,
   "action": "Publish and verify the Solmere Edge API route after bank certification",
   "id": "item-6"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 0.5,
    "op": "<",
    "metric": "wallet_error_rate_pct"
   },
   "start": "2026-06-11T09:00:00Z",
   "percent": 5,
   "action": "Enable Wallet Client for 5% of Solmere regional traffic",
   "id": "item-7"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 80,
    "op": ">",
    "metric": "support_staff_coverage_pct"
   },
   "start": "2026-06-16T09:00:00Z",
   "percent": 100,
   "action": "Increase Solmere Wallet Client to 100% after the staffed holiday window",
   "id": "item-8"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 99,
    "op": ">",
    "metric": "api_ready_pct"
   },
   "start": "2026-06-16T12:00:00Z",
   "percent": null,
   "action": "Publish and verify the Kestrel and Veyra Edge API routes",
   "id": "item-9"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 0.5,
    "op": "<",
    "metric": "wallet_error_rate_pct"
   },
   "start": "2026-06-17T09:00:00Z",
   "percent": 5,
   "action": "Enable Wallet Client for 5% of Kestrel regional traffic",
   "id": "item-10"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 0.5,
    "op": "<",
    "metric": "wallet_error_rate_pct"
   },
   "start": "2026-06-17T13:00:00Z",
   "percent": 100,
   "action": "Increase Kestrel Wallet Client to 100% of regional traffic",
   "id": "item-11"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 1,
    "op": "<",
    "metric": "residency_violation_count"
   },
   "start": "2026-06-19T09:00:00Z",
   "percent": 5,
   "action": "Enable Wallet Client for 5% of Veyra regional traffic in the Veyra cluster",
   "id": "item-12"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 0.5,
    "op": "<",
    "metric": "wallet_error_rate_pct"
   },
   "start": "2026-06-19T13:00:00Z",
   "percent": 100,
   "action": "Increase Veyra Wallet Client to 100% while residency remains clean",
   "id": "item-13"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 99.5,
    "op": ">",
    "metric": "contract_success_rate_pct"
   },
   "start": "2026-06-22T09:00:00Z",
   "percent": null,
   "action": "Finalize the partner contract check and close the regional rollout",
   "id": "item-14"
  }
 ],
 "capacity": {
  "canaryPercent": 5
 },
 "risk": {
  "evidence": [
   "ops/config/runtime.yaml:3",
   "ops/logs/wallet-session.log:198"
  ],
  "decoy": "partner TLS certificate renewal warnings are a routine warning, not the authorization failure",
  "cause": "wallet-session connection-pool exhaustion at the 80-connection ceiling creates waiters and retries as traffic rises"
 }
}
```

## Ownership

Release Engineering coordinates the sequence. Data Platform owns schema expansion, Edge API owns regional routes, Wallet Client owns regional flags, Regional Operations owns staffed handoffs, and Partner Integrations owns the bank contract check. Observability maintains the gates and alert view. Privacy Engineering owns Veyra residency approval. Customer Support owns customer communications and staffed response.

## Rollback

Trigger rollback when `wallet_error_rate_pct > 1.0` for 10 minutes. Disable the most recently enabled Wallet Client regional flag, restore its prior regional percentage, keep the Edge API route and schema expansion available for diagnosis, and notify Release Manager, Customer Support, and Observability. Do not remove the expanded schema during investigation.

## Go or no-go decisions

- Before `noria-full`, the **Release Manager** decides after the Noria canary gate, pool utilization, and retry rate are stable.
- Before `solmere-full`, the **Support Lead** decides after `support_staff_coverage_pct` is above 80, the holiday handoff is staffed, and bank certification is active.
- Before `veyra-canary`, the **Privacy Lead** decides after `residency_violation_count` is zero and the Veyra-cluster sample is clean.
- Before `contract-final`, the **Release Manager** decides after all four regional flags are at their planned level and the contract-success gate is green.

## Execution schedule

Percentages are the share of traffic within the named region after a step. A null percentage means the step moves no traffic. Every step has a gate sampled for the stated window.

| ID | Planned start UTC | Action | After step | Gate |
|---|---|---|---:|---|
| schema-expand | 2026-06-08T09:00:00Z | Expand the nullable `region_code` schema; keep the flag disabled | null | `schema_compatibility_pct > 99.9` for 15 min |
| schema-writer | 2026-06-08T10:00:00Z | Enable the session `region_code` writer after the expanded schema is healthy | null | `schema_compatibility_pct > 99.9` for 15 min |
| noria-api | 2026-06-08T12:00:00Z | Publish and verify the Noria Edge API route | null | `api_ready_pct > 99` for 10 min |
| noria-canary | 2026-06-09T09:00:00Z | Enable Wallet Client for 5% of Noria regional traffic | 5 | `wallet_error_rate_pct < 0.5` for 10 min |
| noria-full | 2026-06-09T13:00:00Z | Increase Noria Wallet Client to 100% of regional traffic | 100 | `wallet_error_rate_pct < 0.5` for 10 min |
| solmere-api | 2026-06-10T09:00:00Z | Publish and verify the Solmere Edge API route after bank certification | null | `partner_certification_ok > 0` for 5 min |
| solmere-canary | 2026-06-11T09:00:00Z | Enable Wallet Client for 5% of Solmere regional traffic | 5 | `wallet_error_rate_pct < 0.5` for 10 min |
| solmere-full | 2026-06-16T09:00:00Z | Increase Solmere Wallet Client to 100% after the staffed holiday window | 100 | `support_staff_coverage_pct > 80` for 10 min |
| remaining-apis | 2026-06-16T12:00:00Z | Publish and verify the Kestrel and Veyra Edge API routes | null | `api_ready_pct > 99` for 10 min |
| kestrel-canary | 2026-06-17T09:00:00Z | Enable Wallet Client for 5% of Kestrel regional traffic | 5 | `wallet_error_rate_pct < 0.5` for 10 min |
| kestrel-full | 2026-06-17T13:00:00Z | Increase Kestrel Wallet Client to 100% of regional traffic | 100 | `wallet_error_rate_pct < 0.5` for 10 min |
| veyra-canary | 2026-06-19T09:00:00Z | Enable Wallet Client for 5% of Veyra regional traffic in the Veyra cluster | 5 | `residency_violation_count < 1` for 10 min |
| veyra-full | 2026-06-19T13:00:00Z | Increase Veyra Wallet Client to 100% while residency remains clean | 100 | `wallet_error_rate_pct < 0.5` for 10 min |
| contract-final | 2026-06-22T09:00:00Z | Finalize the partner contract check and close the regional rollout | null | `contract_success_rate_pct > 99.5` for 10 min |

The schedule avoids the global freeze from 2026-06-12T18:00:00Z through 2026-06-15T06:00:00Z and the Veyra coverage gap from 2026-06-18T00:00:00Z through 2026-06-18T08:00:00Z.

## Release posture

The launch configuration caps `wallet-session` at 80 active connections. The observed failure mode is connection-pool exhaustion at that ceiling, followed by waiters and retries. The canary therefore stays at 5% per region, with a ten-minute observation window before any regional increase. The certificate-renewal warnings in the partner logs are an existing warning and do not explain the authorization failures.

The schema expansion is backward compatible while `wallet_session.region_code` remains nullable. The writer flag stays off until the expanded schema and readers are healthy. Edge API routing is published and verified before Wallet Client enables a regional flag. Solmere waits for the Northstar Bank certification at 2026-06-10T09:00:00Z and is not increased on the 2026-06-15 public holiday. Veyra changes run only when the support rota is staffed and the residency counter remains zero; wallet records and session keys stay in the Veyra cluster.
