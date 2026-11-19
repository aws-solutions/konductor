# Operator notes

Use the `rate` command for a quick quote. The required inputs are a zone and
weight. Service names are `ground`, `priority`, and `overnight`. Delivery flags
can be combined when the order needs them.

Use `--json` when another program will consume the result. The JSON object
contains the total, component amounts, normalized zone, weight label, service,
holiday flag, and currency.

The `label` command reads one JSON object. Its required keys are `order_id`,
`recipient`, `address`, `city`, and `postal_code`; `service` and `total` are
optional display fields.
