# Aurora Wallet four-region rollout plan

**Decision owner:** Release Manager  
**Review:** Monday 2026-06-22 at 09:00Z  
**Scope:** Noria, Solmere, Kestrel, and Veyra

## Release posture

The launch configuration caps `wallet-session` at 80 active connections. The observed failure mode is connection-pool exhaustion at that ceiling, followed by waiters and retries. The canary therefore stays at 5% per region, with a ten-minute observation window before any regional increase. The certificate-renewal warnings in the partner logs are an existing warning and do not explain the authorization failures.

The schema expansion is backward compatible while `wallet_session.region_code` remains nullable. The writer flag stays off until the expanded schema and readers are healthy. Edge API routing is published and verified before Wallet Client enables a regional flag. Solmere waits for the Northstar Bank certification at 2026-06-10T09:00:00Z and is not increased on the 2026-06-15 public holiday. Veyra changes run only when the support rota is staffed and the residency counter remains zero; wallet records and session keys stay in the Veyra cluster.

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

## Go or no-go decisions

- Before `noria-full`, the **Release Manager** decides after the Noria canary gate, pool utilization, and retry rate are stable.
- Before `solmere-full`, the **Support Lead** decides after `support_staff_coverage_pct` is above 80, the holiday handoff is staffed, and bank certification is active.
- Before `veyra-canary`, the **Privacy Lead** decides after `residency_violation_count` is zero and the Veyra-cluster sample is clean.
- Before `contract-final`, the **Release Manager** decides after all four regional flags are at their planned level and the contract-success gate is green.

## Rollback

Trigger rollback when `wallet_error_rate_pct > 1.0` for 10 minutes. Disable the most recently enabled Wallet Client regional flag, restore its prior regional percentage, keep the Edge API route and schema expansion available for diagnosis, and notify Release Manager, Customer Support, and Observability. Do not remove the expanded schema during investigation.

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
    "canaryPercent": 5
  },
  "steps": [
    {
      "id": "schema-expand",
      "action": "Expand the nullable region_code schema and keep the flag disabled",
      "percent": null,
      "start": "2026-06-08T09:00:00Z",
      "gate": {"metric": "schema_compatibility_pct", "op": ">", "threshold": 99.9, "windowMin": 15}
    },
    {
      "id": "schema-writer",
      "action": "Enable the session region_code writer after the expanded schema is healthy",
      "percent": null,
      "start": "2026-06-08T10:00:00Z",
      "gate": {"metric": "schema_compatibility_pct", "op": ">", "threshold": 99.9, "windowMin": 15}
    },
    {
      "id": "noria-api",
      "action": "Publish and verify the Noria Edge API route",
      "percent": null,
      "start": "2026-06-08T12:00:00Z",
      "gate": {"metric": "api_ready_pct", "op": ">", "threshold": 99, "windowMin": 10}
    },
    {
      "id": "noria-canary",
      "action": "Enable Wallet Client for 5% of Noria regional traffic",
      "percent": 5,
      "start": "2026-06-09T09:00:00Z",
      "gate": {"metric": "wallet_error_rate_pct", "op": "<", "threshold": 0.5, "windowMin": 10}
    },
    {
      "id": "noria-full",
      "action": "Increase Noria Wallet Client to 100% of regional traffic",
      "percent": 100,
      "start": "2026-06-09T13:00:00Z",
      "gate": {"metric": "wallet_error_rate_pct", "op": "<", "threshold": 0.5, "windowMin": 10}
    },
    {
      "id": "solmere-api",
      "action": "Publish and verify the Solmere Edge API route after bank certification",
      "percent": null,
      "start": "2026-06-10T09:00:00Z",
      "gate": {"metric": "partner_certification_ok", "op": ">", "threshold": 0, "windowMin": 5}
    },
    {
      "id": "solmere-canary",
      "action": "Enable Wallet Client for 5% of Solmere regional traffic",
      "percent": 5,
      "start": "2026-06-11T09:00:00Z",
      "gate": {"metric": "wallet_error_rate_pct", "op": "<", "threshold": 0.5, "windowMin": 10}
    },
    {
      "id": "solmere-full",
      "action": "Increase Solmere Wallet Client to 100% after the staffed holiday window",
      "percent": 100,
      "start": "2026-06-16T09:00:00Z",
      "gate": {"metric": "support_staff_coverage_pct", "op": ">", "threshold": 80, "windowMin": 10}
    },
    {
      "id": "remaining-apis",
      "action": "Publish and verify the Kestrel and Veyra Edge API routes",
      "percent": null,
      "start": "2026-06-16T12:00:00Z",
      "gate": {"metric": "api_ready_pct", "op": ">", "threshold": 99, "windowMin": 10}
    },
    {
      "id": "kestrel-canary",
      "action": "Enable Wallet Client for 5% of Kestrel regional traffic",
      "percent": 5,
      "start": "2026-06-17T09:00:00Z",
      "gate": {"metric": "wallet_error_rate_pct", "op": "<", "threshold": 0.5, "windowMin": 10}
    },
    {
      "id": "kestrel-full",
      "action": "Increase Kestrel Wallet Client to 100% of regional traffic",
      "percent": 100,
      "start": "2026-06-17T13:00:00Z",
      "gate": {"metric": "wallet_error_rate_pct", "op": "<", "threshold": 0.5, "windowMin": 10}
    },
    {
      "id": "veyra-canary",
      "action": "Enable Wallet Client for 5% of Veyra regional traffic in the Veyra cluster",
      "percent": 5,
      "start": "2026-06-19T09:00:00Z",
      "gate": {"metric": "residency_violation_count", "op": "<", "threshold": 1, "windowMin": 10}
    },
    {
      "id": "veyra-full",
      "action": "Increase Veyra Wallet Client to 100% while residency remains clean",
      "percent": 100,
      "start": "2026-06-19T13:00:00Z",
      "gate": {"metric": "wallet_error_rate_pct", "op": "<", "threshold": 0.5, "windowMin": 10}
    },
    {
      "id": "contract-final",
      "action": "Finalize the partner contract check and close the regional rollout",
      "percent": null,
      "start": "2026-06-22T09:00:00Z",
      "gate": {"metric": "contract_success_rate_pct", "op": ">", "threshold": 99.5, "windowMin": 10}
    }
  ],
  "rollback": {
    "trigger": {"metric": "wallet_error_rate_pct", "op": ">", "threshold": 1.0, "windowMin": 10},
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
    {"id": "schema-expand", "team": "Data Platform"},
    {"id": "schema-writer", "team": "Data Platform"},
    {"id": "noria-api", "team": "Edge API"},
    {"id": "noria-canary", "team": "Wallet Client"},
    {"id": "noria-full", "team": "Wallet Client"},
    {"id": "solmere-api", "team": "Edge API"},
    {"id": "solmere-canary", "team": "Wallet Client"},
    {"id": "solmere-full", "team": "Regional Operations"},
    {"id": "remaining-apis", "team": "Edge API"},
    {"id": "kestrel-canary", "team": "Wallet Client"},
    {"id": "kestrel-full", "team": "Wallet Client"},
    {"id": "veyra-canary", "team": "Privacy Engineering"},
    {"id": "veyra-full", "team": "Wallet Client"},
    {"id": "contract-final", "team": "Partner Integrations"}
  ],
  "goNoGo": [
    {
      "before": "noria-full",
      "decider": "Release Manager",
      "criteria": ["wallet_error_rate_pct remains below 0.5 for 10 minutes", "connection_pool_utilization_pct remains below 70", "Noria canary retries are stable"]
    },
    {
      "before": "solmere-full",
      "decider": "Support Lead",
      "criteria": ["support_staff_coverage_pct is above 80", "the Solmere holiday handoff is staffed", "partner_certification_ok is 1"]
    },
    {
      "before": "veyra-canary",
      "decider": "Privacy Lead",
      "criteria": ["residency_violation_count is zero", "the Veyra cluster sample is clean", "Veyra support coverage is staffed"]
    },
    {
      "before": "contract-final",
      "decider": "Release Manager",
      "criteria": ["all regional flags are at their planned level", "contract_success_rate_pct is above 99.5", "rollback alerts are armed"]
    }
  ]
}
```
