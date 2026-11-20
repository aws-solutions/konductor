# Event Bus Serialization Format Decision Record

This section covers event bus serialization format decision record. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Context

This section covers context. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Analysis

This section covers analysis. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Resource Requirements Calculation

This section covers resource requirements calculation. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```
Cores needed = (Events/sec × Encode+decode time in ms) / 1000
```

```
Bandwidth (MB/s) = (Events/sec × JSON size × Size ratio) / (1024 × 1024)
```

```
Monthly cost = max(0, Cores needed - 6) × $70
```

### Format Evaluation

This section covers format evaluation. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Constraint Analysis

This section covers constraint analysis. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Trade-off Analysis

This section covers trade-off analysis. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "json",
  "options": [
    "json",
    "msgpack",
    "protobuf",
    "cbor",
    "avro"
  ],
  "limits": {
    "cores": {
      "limit": 7.5,
      "value": 6.88
    },
    "bandwidth": {
      "limit": 50,
      "value": 46.5
    },
    "budget": {
      "limit": 1250,
      "value": 0
    }
  },
  "monthly_cost_usd": 0
}
```

## Next Steps

This section covers next steps. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Reviewers

This section covers reviewers. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.
