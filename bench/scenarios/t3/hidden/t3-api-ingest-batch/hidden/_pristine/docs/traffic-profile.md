# Fleet traffic profile

The production fleet has 40,000 active devices. Each device emits one reading every 10 seconds, continuously. This produces a steady stream rather than a morning or evening burst. The API should accept batches without making a caller coordinate device-specific connections.

| Planning measure | Production value | Interpretation |
|---|---:|---|
| Active devices | 40,000 | Devices sending readings |
| Reading interval | 10 seconds | One reading per device per interval |
| Encoded reading | 380 bytes | Typical JSON representation |
| Planning month | 30 days | Used for the cost model |

A separate demonstration environment once used 4,000 devices and a 60-second interval. That example is superseded for production capacity planning.
