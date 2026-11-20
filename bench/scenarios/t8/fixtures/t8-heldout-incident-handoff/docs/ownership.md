# Who owns what

| Team | Owns | On-call |
| --- | --- | --- |
| Billing Core | invoice-api, the invoice schema | #billing-core-oncall |
| Documents | render-worker, PDF templates | #documents-oncall |
| Tax Engine | tax rules, the tax-recalc job, the `bulk_tax_recalc` and `tax_rules_v2` flags | #tax-engine-oncall |
| Data Platform | Postgres primary and replica, backups, pgctl | #data-platform-oncall |
| Growth | dark mode, the new invoice editor and other UI flags | #growth |
| Release Engineering | deployctl, the deploy pipeline | #release-eng |
