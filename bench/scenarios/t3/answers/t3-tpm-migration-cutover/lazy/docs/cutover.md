# Cutover decision

We will use the big-bang copy. It is the simplest option and has the lowest monthly charge, so it fits the budget
with room to spare. The team will rehearse it first and follow the usual change checklist on Sunday.

```decision
{"chosen":"big_bang_copy","options":["big_bang_copy","continuous_replication","dual_write"],"limits":{"downtime_min":{"limit":20,"value":15},"rpo_min":{"limit":5,"value":0},"latency_ms":{"limit":30,"value":20},"throughput_mb_s":{"limit":150,"value":450},"monthly_cost_usd":{"limit":5000,"value":3200}},"monthly_cost_usd":3200}
```
