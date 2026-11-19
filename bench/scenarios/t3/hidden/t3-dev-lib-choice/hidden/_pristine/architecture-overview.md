# Event Bus Architecture Overview

## System Context
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Producers     │────│   Event Bus     │────│   Consumers     │
│   (Services)    │    │   (Internal)    │    │   (Processors)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Telemetry     │    │   Serialization │    │   Analytics     │
│   Sources       │    │   Layer         │    │   Storage       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Data Flow
1. Producers generate events with telemetry data
2. Events are serialized and published to the bus
3. Consumers deserialize and process events
4. Processed data is stored for analytics

## Current Bottlenecks
Based on load testing with the legacy JSON implementation:

1. **CPU Utilization**: Serialization/deserialization consumes 85% of CPU time
2. **Network Bandwidth**: JSON text representation causes high cross-AZ transfer costs
3. **Memory Pressure**: Large string allocations during parsing

## Deployment Context
- **Primary Region**: us-east-1 (3 AZs)
- **Consumer Fleet**: 3x c5.xlarge instances (4 vCPUs each, but only 2 cores allocated to event processing per instance)
- **Network**: Cross-AZ traffic charged at $0.01/GB (see cost sheet)
- **Storage**: Events archived to S3 after 7 days, queried via Athena

## Performance Targets (Q2 2024)
These targets were established in the Q1 planning review:
- Maximum serialization latency: 0.5 ms P99 (target)
- Maximum deserialization latency: 0.5 ms P99 (target)  
- Combined encode+decode: ≤ 1.0 ms P99 (current requirement)

Note: The 0.5 ms target per operation was set before we understood the full scale requirements. The combined 1.0 ms limit remains valid.