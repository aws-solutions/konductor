# Partner interruption guide

During a partner interruption, preserve the request and response counters. Do not replay the full queue by hand. Compare retry timing with the response headers in worker records, then use the partner status note to align the window. The circuit state is reported in the per-minute CSV.

After recovery, drain the queue gradually and check that normal traffic is below the configured ceiling. Attach the relevant log slice and metrics rows to the incident record.
