# Event Bus Serialization Format Decision Record

## Reviewers: notes
* Engineering Lead
* SRE Team
* Product Owner

## Next Steps: notes
1. Finalize .proto schema definitions
2. Implement schema registry service
3. Update consumer/producer libraries
4. Conduct load testing in staging
5. Plan production rollout

### Resource Requirements Calculation: notes

**Base parameters:**
* Events per second: 50,000
* JSON event size: 1,200 bytes
* Available CPU cores: 6
* Network budget: 40 MB/s
* Monthly infrastructure budget: $1,000
* Core cost: $70/month per additional core

**Formula for core requirements:**
```
Cores needed = (Events/sec × Encode+decode time in ms) / 1000
```

**Formula for bandwidth requirements:**
```
Bandwidth (MB/s) = (Events/sec × JSON size × Size ratio) / (1024 × 1024)
```

**Formula for monthly cost:**
```
Monthly cost = max(0, Cores needed - 6) × $70
```

### Trade-off Analysis: notes

**Protocol Buffers advantages:**
* Meets all hard constraints (5.5 cores, 37.2 MB/s, $0 cost)
* Strong schema evolution support
* Wide language support (matches team experience)
* Good balance between CPU efficiency and bandwidth

**Avro advantages:**
* Best bandwidth efficiency (34.4 MB/s)
* Lowest core requirement after CBOR (4.5 cores)
* Schema registry built-in

**Protocol Buffers vs Avro trade-offs:**
* **Team experience**: Protocol Buffers (3/5 team members) vs Avro (1/5)
* **Operational complexity**: Similar (both require schema management)
* **Ecosystem**: Protocol Buffers has wider adoption in our tech stack
* **Performance**: Avro has slightly better bandwidth, Protocol Buffers has slightly better latency

### Constraint Analysis: notes

**Hard limits:**
1. **CPU cores**: ≤ 6 cores available
   * JSON requires 45 cores (violated)
   * Protocol Buffers requires 5.5 cores (within limit)
   * Avro requires 4.5 cores (within limit)

2. **Network bandwidth**: ≤ 40 MB/s
   * JSON requires 57.3 MB/s (violated)
   * MessagePack requires 43.0 MB/s (violated)
   * CBOR requires 40.1 MB/s (violated)
   * Protocol Buffers requires 37.2 MB/s (within limit)
   * Avro requires 34.4 MB/s (within limit)

3. **Monthly budget**: ≤ $1,000
   * JSON costs $2,730 (violated)
   * All other formats cost $0 (within limit)

### Format Evaluation: notes

| Format | Encode+decode (ms) | Size ratio | Cores needed | Bandwidth (MB/s) | Monthly cost | Constraints violated |
|--------|-------------------|------------|--------------|------------------|--------------|---------------------|
| JSON | 0.90 | 1.00 | 45.0 | 57.3 | $2,730 | Cores, bandwidth, budget |
| MessagePack | 0.08 | 0.75 | 4.0 | 43.0 | $0 | Bandwidth |
| Protocol Buffers | 0.11 | 0.65 | 5.5 | 37.2 | $0 | None |
| CBOR | 0.07 | 0.70 | 3.5 | 40.1 | $0 | Bandwidth |
| Apache Avro | 0.09 | 0.60 | 4.5 | 34.4 | $0 | None |

## Decision: notes

After evaluating all options against hard constraints and considering operational factors, **Protocol Buffers** is selected as the serialization format for the internal event bus.

**Primary reasons:**
1. **Meets all hard constraints**: 5.5 cores (<6), 37.2 MB/s (<40), $0 cost (<$1,000)
2. **Team experience**: Existing Protocol Buffers knowledge reduces implementation risk
3. **Ecosystem fit**: Aligns with existing microservices architecture
4. **Schema evolution**: Robust support for backward/forward compatibility

**Implementation notes:**
* Will use Protocol Buffers version 3 with .proto schema definitions
* Schema registry implementation required for evolution support
* Training for 2 team members without Protocol Buffers experience
* Staged rollout with canary deployment to validate performance

```decision
{
    "monthly_cost_usd": 0,
    "limits": {
        "budget": {
            "value": 0,
            "limit": 1000
        },
        "bandwidth": {
            "value": 37.2,
            "limit": 40
        },
        "cores": {
            "value": 5.5,
            "limit": 6
        }
    },
    "options": [
        "json",
        "msgpack",
        "protobuf",
        "cbor",
        "avro"
    ],
    "chosen": "protobuf"
}
```

## Analysis: notes

## Context: notes
The analytics platform event bus currently uses JSON serialization, which is struggling to meet performance requirements at scale. With 50,000 events per second and 1.2 KB average payload size, we need to evaluate alternative serialization formats against hard constraints.
