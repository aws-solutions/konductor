# Context: delivering order events to partners

Partners (marketplace sellers' systems) need to know when an order is placed, paid, shipped or cancelled. Today
they log in to a dashboard. We must choose how order events reach their systems.

## Constraints

- Volume: about 1.8 million order events a day across all partners (sum of `orders_per_day` in `data/partners.csv`),
  peak 120 events a second.
- Freshness: a partner must see an event within 60 s at p95.
- Partners: `data/partners.csv` lists every partner and whether it can host an HTTPS endpoint
  (`webhook_capable`). Partners that cannot are mostly small sellers on shared hosting; they can make outbound
  HTTPS calls.
- Partner API rate limit we apply today: one request every 10 s per partner.
- Team: 2 engineers. No on-call rota for running brokers ourselves; managed cloud services are fine.
- Budget: 1,500 USD a month for the delivery path.
- Events must not be lost. A partner that is down for up to 24 h must get every event when it is back, in order
  per order.

## Options the team has named

- Webhooks: we POST each event to the partner's endpoint, with retries.
- Pull feed: partners poll an events endpoint with a cursor (`GET /events?after=...`).
- Managed queue per partner: a cloud queue per partner that the partner reads with its own credentials.
- Email digest: a summary every 15 minutes.

Other options are welcome.
