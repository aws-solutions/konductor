-- Read-only reference query used during an incident.
select timestamp, retries, partner_requests from partner_minute where retries > 0 order by timestamp;
