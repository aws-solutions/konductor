# Configuration

JSON files under `config/` are intentionally plain. `heartbeatIntervalMs` controls idle pings and `maxPayloadBytes` limits serialized notification size. The environment name is informational.

The library constructor also accepts `heartbeatIntervalMs`, which is useful for embedding the service in a host with its own configuration loader.
