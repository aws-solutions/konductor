# Order sync response guide

Check `ops/metrics/partner-minute.csv` for partner request volume, response classes, retries, and queue depth. Pair a spike with `ops/logs/worker-2025-03-18.log` using the request id. The normal path is one transport call per order. A response that is not successful is returned to the queue consumer after the client attempt budget is used.

The partner status page is copied into `ops/partner-status-note.md`. Record the UTC start and end of any partner event in the incident alert. Check deploy history before changing worker settings. The limiter snapshot in `config/limiter.json` is the current production setting.
