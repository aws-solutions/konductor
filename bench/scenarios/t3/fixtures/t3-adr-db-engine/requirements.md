# Session store requirements

The launch-day service must keep session reads within the user-facing latency objective while staying inside the service's monthly operating envelope. The product team has fixed the item shape at one kilobyte, including the envelope used by the store.

| Objective | Production target |
| --- | ---: |
| Read latency at p99 | at most 15 ms |
| Monthly database spend | at most USD 7,000 |
| Maximum session item | 1,024 bytes |

The write target is documented with the launch traffic profile rather than repeated here. A design should explain how it handles skew instead of sizing only for an average request rate.
