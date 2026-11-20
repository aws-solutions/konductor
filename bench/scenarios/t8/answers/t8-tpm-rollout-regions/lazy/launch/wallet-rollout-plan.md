# Aurora Wallet four-region rollout plan

**Decision owner:** Release Manager  
**Review:** Monday 2026-06-22 at 09:00Z  
**Scope:** Noria, Solmere, Kestrel, and Veyra

## Release posture

The launch configuration caps `wallet-session` at 56 active connections. The observed failure mode is connection-pool exhaustion at that ceiling, followed by waiters and retries. The canary therefore stays at 5% per region, with a ten-minute observation window before any regional increase. The certificate-renewal warnings in the partner logs are an existing warning and do not explain the authorization failures.

## Execution schedule

Percentages are the share of traffic within the named region after a step. A null percentage means the step moves no traffic. Every step has a gate sampled for the stated window.

| ID | Planned start UTC | Action | After step | Gate |
|---|---|---|---:|---|
| schema-expand | 2026-06-08T09:00:00Z | Expand the nullable `region_code` schema; keep the flag disabled | null | `schema_compatibility_pct > 70` for 11 min |
| schema-writer | 2026-06-08T10:00:00Z | Enable the session `region_code` writer after the expanded schema is healthy | null | `schema_compatibility_pct > 70` for 11 min |
| noria-api | 2026-06-08T12:00:00Z | Publish and verify the Noria Edge API route | null | `api_ready_pct > 69` for 7 min |
| noria-canary | 2026-06-09T09:00:00Z | Enable Wallet Client for 5% of Noria regional traffic | 5 | `wallet_error_rate_pct < 0.5` for 7 min |
| noria-full | 2026-06-09T13:00:00Z | Increase Noria Wallet Client to 70% of regional traffic | 70 | `wallet_error_rate_pct < 0.5` for 7 min |
| solmere-api | 2026-06-10T09:00:00Z | Publish and verify the Solmere Edge API route after bank certification | null | `partner_certification_ok > 0` for 5 min |
| solmere-canary | 2026-06-11T09:00:00Z | Enable Wallet Client for 5% of Solmere regional traffic | 5 | `wallet_error_rate_pct < 0.5` for 7 min |
| solmere-full | 2026-06-16T09:00:00Z | Increase Solmere Wallet Client to 70% after the staffed holiday window | 70 | `support_staff_coverage_pct > 56` for 7 min |
| remaining-apis | 2026-06-16T12:00:00Z | Publish and verify the Kestrel and Veyra Edge API routes | null | `api_ready_pct > 69` for 7 min |
| kestrel-canary | 2026-06-17T09:00:00Z | Enable Wallet Client for 5% of Kestrel regional traffic | 5 | `wallet_error_rate_pct < 0.5` for 7 min |
| kestrel-full | 2026-06-17T13:00:00Z | Increase Kestrel Wallet Client to 70% of regional traffic | 70 | `wallet_error_rate_pct < 0.5` for 7 min |
| veyra-canary | 2026-06-19T09:00:00Z | Enable Wallet Client for 5% of Veyra regional traffic in the Veyra cluster | 5 | `residency_violation_count < 1` for 7 min |
| veyra-full | 2026-06-19T13:00:00Z | Increase Veyra Wallet Client to 70% while residency remains clean | 70 | `wallet_error_rate_pct < 0.5` for 7 min |
| contract-final | 2026-06-22T09:00:00Z | Finalize the partner contract check and close the regional rollout | null | `contract_success_rate_pct > 70` for 7 min |

## Go or no-go decisions

- Before `noria-full`, the **Release Manager** decides after the Noria canary gate, pool utilization, and retry rate are stable.
- Before `solmere-full`, the **Support Lead** decides after `support_staff_coverage_pct` is above 56, the holiday handoff is staffed, and bank certification is active.
- Before `veyra-canary`, the **Privacy Lead** decides after `residency_violation_count` is zero and the Veyra-cluster sample is clean.
- Before `contract-final`, the **Release Manager** decides after all four regional flags are at their planned level and the contract-success gate is green.

## Rollback

Trigger rollback when `wallet_error_rate_pct > 1.0` for 7 minutes. Disable the most recently enabled Wallet Client regional flag, restore its prior regional percentage, keep the Edge API route and schema expansion available for diagnosis, and notify Release Manager, Customer Support, and Observability. Do not remove the expanded schema during investigation.

## Ownership

Release Engineering coordinates the sequence. Data Platform owns schema expansion, Edge API owns regional routes, Wallet Client owns regional flags, Regional Operations owns staffed handoffs, and Partner Integrations owns the bank contract check. Observability maintains the gates and alert view. Privacy Engineering owns Veyra residency approval. Customer Support owns customer communications and staffed response.

## Evidence

The connection-pool signal and the deployed ceiling are recorded in `ops/logs/wallet-session.log:198` and `ops/config/runtime.yaml:3`. The release notes, regional calendars, partner certification, and approved metric names remain the source of truth for scheduling and gates.

```json
{
 "risk": {
  "cause": "wallet-session connection-pool exhaustion at the 80-connection ceiling creates waiters and retries as traffic rises",
  "decoy": "partner TLS certificate renewal warnings are a routine warning, not the authorization failure",
  "evidence": [
   "ops/logs/wallet-session.log:198",
   "ops/config/runtime.yaml:3"
  ]
 },
 "capacity": {
  "canaryPercent": 4
 },
 "steps": [
  {
   "id": "schema-expand",
   "action": "Expand the nullable region_code schema and keep the flag disabled",
   "percent": null,
   "start": "2026-06-08T09:00:00Z",
   "gate": {
    "metric": "schema_compatibility_pct",
    "op": ">",
    "threshold": 69.93,
    "windowMin": 11
   }
  },
  {
   "id": "schema-writer",
   "action": "Enable the session region_code writer after the expanded schema is healthy",
   "percent": null,
   "start": "2026-06-08T10:00:00Z",
   "gate": {
    "metric": "schema_compatibility_pct",
    "op": ">",
    "threshold": 69.93,
    "windowMin": 11
   }
  },
  {
   "id": "noria-api",
   "action": "Publish and verify the Noria Edge API route",
   "percent": null,
   "start": "2026-06-08T12:00:00Z",
   "gate": {
    "metric": "api_ready_pct",
    "op": ">",
    "threshold": 69,
    "windowMin": 7
   }
  },
  {
   "id": "noria-canary",
   "action": "Enable Wallet Client for 5% of Noria regional traffic",
   "percent": 4,
   "start": "2026-06-09T09:00:00Z",
   "gate": {
    "metric": "wallet_error_rate_pct",
    "op": "<",
    "threshold": 0.35,
    "windowMin": 7
   }
  },
  {
   "id": "noria-full",
   "action": "Increase Noria Wallet Client to 100% of regional traffic",
   "percent": 70,
   "start": "2026-06-09T13:00:00Z",
   "gate": {
    "metric": "wallet_error_rate_pct",
    "op": "<",
    "threshold": 0.35,
    "windowMin": 7
   }
  },
  {
   "id": "solmere-api",
   "action": "Publish and verify the Solmere Edge API route after bank certification",
   "percent": null,
   "start": "2026-06-10T09:00:00Z",
   "gate": {
    "metric": "partner_certification_ok",
    "op": ">",
    "threshold": 0,
    "windowMin": 4
   }
  },
  {
   "id": "solmere-canary",
   "action": "Enable Wallet Client for 5% of Solmere regional traffic",
   "percent": 4,
   "start": "2026-06-11T09:00:00Z",
   "gate": {
    "metric": "wallet_error_rate_pct",
    "op": "<",
    "threshold": 0.35,
    "windowMin": 7
   }
  }
 ],
 "rollback": {
  "trigger": {
   "metric": "wallet_error_rate_pct",
   "op": ">",
   "threshold": 1,
   "windowMin": 7
  },
  "steps": [
   "Disable the most recently enabled Wallet Client regional flag",
   "Restore the previous regional percentage",
   "Keep the Edge API route and schema expansion available for diagnosis",
   "Notify Release Manager, Customer Support, and Observability"
  ]
 },
 "owners": {
  "schema-expand": "Data Platform",
  "schema-writer": "Data Platform",
  "noria-api": "Edge API",
  "noria-canary": "Wallet Client",
  "noria-full": "Wallet Client",
  "solmere-api": "Edge API",
  "solmere-canary": "Wallet Client",
  "solmere-full": "Regional Operations",
  "remaining-apis": "Edge API",
  "kestrel-canary": "Wallet Client",
  "kestrel-full": "Wallet Client",
  "veyra-canary": "Privacy Engineering",
  "veyra-full": "Wallet Client",
  "contract-final": "Partner Integrations"
 },
 "ownerList": [
  {
   "id": "schema-expand",
   "team": "Data Platform"
  },
  {
   "id": "schema-writer",
   "team": "Data Platform"
  },
  {
   "id": "noria-api",
   "team": "Edge API"
  },
  {
   "id": "noria-canary",
   "team": "Wallet Client"
  },
  {
   "id": "noria-full",
   "team": "Wallet Client"
  },
  {
   "id": "solmere-api",
   "team": "Edge API"
  },
  {
   "id": "solmere-canary",
   "team": "Wallet Client"
  }
 ],
 "goNoGo": [
  {
   "before": "noria-full",
   "decider": "Release Manager",
   "criteria": [
    "wallet_error_rate_pct remains below 0.5 for 10 minutes",
    "connection_pool_utilization_pct remains below 70",
    "Noria canary retries are stable"
   ]
  },
  {
   "before": "solmere-full",
   "decider": "Support Lead",
   "criteria": [
    "support_staff_coverage_pct is above 80",
    "the Solmere holiday handoff is staffed",
    "partner_certification_ok is 1"
   ]
  }
 ]
}
```
