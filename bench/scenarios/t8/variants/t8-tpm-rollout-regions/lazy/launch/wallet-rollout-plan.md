# Notes

I read the README and the main files. Summary below.

```json
{
 "risk": {
  "cause": "wallet-session connection-pool exhaustion at the 80-connection ceiling creates waiters and retries as traffic rises",
  "decoy": "partner TLS certificate renewal warnings are a routine warning, not the authorization failure",
  "evidence": [
   "ops/logs/wallet-session.log:198"
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
    "threshold": 70,
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
    "threshold": 70,
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
    "threshold": 0,
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
    "threshold": 0,
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
    "threshold": 0,
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
   "Restore the previous regional percentage"
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
    "connection_pool_utilization_pct remains below 70"
   ]
  },
  {
   "before": "solmere-full",
   "decider": "Support Lead",
   "criteria": [
    "support_staff_coverage_pct is above 80",
    "the Solmere holiday handoff is staffed"
   ]
  }
 ]
}
```
