# Reporting requirements

**Owner:** Data Products  
**Freshness target:** hourly for operational reports, daily for finance line extracts  
**Retention:** seven years in the reporting bucket

The hourly order report groups orders by merchant, order day, currency, and final status. It must include orders created or status-updated since the previous successful run and must tolerate an order changing status while a run is in progress. The report is used by operations at ten minutes past each hour.

The finance extract contains one record per purchased line. Required fields are order ID, merchant ID, SKU, quantity, amount, currency, created time, and final status. Finance reconciles its row count and amount totals with the order service's daily total.

The reporting role may read order data and write report files, but it may not change order data or table configuration. The reporting allocation is 400 USD per month. Data Products has not requested a separate reporting table for the first migration release. The team will review an export-based design after the first quarter.
