# Load Testing Results - Serialization Formats

## Test Environment
- Hardware: c5.xlarge instances (4 vCPUs, 8 GB RAM)
- OS: Amazon Linux 2
- Network: Enhanced networking enabled
- Test duration: 30 minutes per format
- Warm-up: 5 minutes excluded from results

## Test Methodology
1. Generate 50,000 events per second (synthetic telemetry data)
2. Serialize events using each format
3. Transmit over loopback interface (eliminates network variability)
4. Deserialize and validate
5. Measure CPU utilization, latency, throughput

## Results Summary

### JSON (Baseline)
```
Events/sec: 50,000 (target)
Avg latency (encode+decode): 0.90 ms
CPU cores required: 4.5 per 10,000 events/sec
Network bandwidth: 57.2 MB/s
Memory usage: High (string allocations)
```

### MessagePack
```
Events/sec: 50,000 (achieved)
Avg latency (encode+decode): 0.08 ms  
CPU cores required: 0.8 per 10,000 events/sec
Network bandwidth: 42.9 MB/s
Memory usage: Moderate
```

### Protocol Buffers
```
Events/sec: 50,000 (achieved)
Avg latency (encode+decode): 0.11 ms
CPU cores required: 1.1 per 10,000 events/sec
Network bandwidth: 37.2 MB/s
Memory usage: Low (pre-allocated buffers)
```

### CBOR
```
Events/sec: 50,000 (achieved)
Avg latency (encode+decode): 0.07 ms
CPU cores required: 0.7 per 10,000 events/sec
Network bandwidth: 40.1 MB/s
Memory usage: Moderate
```

### Avro
```
Events/sec: 50,000 (achieved)
Avg latency (encode+decode): 0.09 ms
CPU cores required: 0.9 per 10,000 events/sec
Network bandwidth: 34.4 MB/s
Memory usage: Low
```

## Key Observations
1. **JSON consumes 5-6× more CPU** than binary formats
2. **MessagePack and CBOR** offer best latency but higher bandwidth than Avro/Protobuf
3. **Protocol Buffers** provides good balance of CPU and bandwidth efficiency
4. **Avro** offers best bandwidth efficiency but requires schema registry

## Limitations
- Tests performed on single instance, scaling behavior may differ
- Schema compilation time not included (affects Protobuf/Avro startup)
- Memory measurements from Java implementation, other languages may vary
- Network tests used loopback, real cross-AZ latency adds ~2ms

## Recommendations from Test Team
"Consider bandwidth constraints when selecting format. The 40 MB/s limit is a hard constraint for cross-AZ costs."