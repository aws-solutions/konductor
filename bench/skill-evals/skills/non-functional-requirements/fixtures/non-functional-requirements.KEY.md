# Key: non-functional-requirements
design.md ends with vague adjectives (fast, highly available, secure, reasonable time) to be turned into numbers; PCI scope and $9,000 budget are the concrete anchors.
nfr-draft.md planted gaps: latency not split read/write and no percentile; 99.9% without RTO/RPO; "industry compliance standards" not mapped to PCI DSS; no trace sampling; autoscaling with no thresholds.

## v2 notes
- PCI DSS (v4.0 req 10.5.1) requires audit log retention of at least 12 months with 3 months immediately available. The draft's "logs kept 30 days" (p3) and any p1 answer that sets 30-90 days for audit logs are non-compliant. A strong answer separates audit-trail retention (>= 1 year) from debug/app logs.
- Ledger traffic: 400 writes/s and 2,500 reads/s peak, 3x in December (1,200 w/s, 7,500 r/s). Lambda "autoscaling" is automatic; the meaningful scale NFRs are concurrency headroom (reserved/provisioned concurrency, account limit) and DynamoDB capacity mode / OpenSearch node thresholds.
- statements-design.md (p2): three workload types that need separate performance targets: interactive search (p50/p99 ms), on-demand export (time-to-email, e.g. p95 minutes), month-end batch (completion window, e.g. all 2.1M statements by 06:00 local, throughput statements/min, growth 4%/mo). Pre-signed URL expiry must be a number. Vague phrases to quantify: "feel instant", "ready in the morning", "short-lived". Cost anchor $3,500/mo; per-statement cost is derivable (~$3,500 / 2.1M ~ $0.0017 per pre-rendered statement as an upper bound).
