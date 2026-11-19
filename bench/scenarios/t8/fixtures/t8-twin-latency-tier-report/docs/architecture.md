# Checkout service map

Northstar Shop is a small online store. The public checkout API accepts the cart, asks inventory-service to reserve stock, and sends payment authorization to payments-adapter. Checkout API uses the `checkout` database route through `db-pooler`, which forwards to the Postgres primary.

The pooler keeps a separate client pool for checkout traffic. The checkout process has its own acquire timeout so a request does not wait forever. Health endpoints do not exercise a complete order, so a green health check does not prove that an order can acquire a database connection.

The order path is:

`browser -> checkout-api -> inventory-service + payments-adapter -> db-pooler -> Postgres`

Logs use the service name in each line. The pooler log records pool state and administrative events. The metric file is sampled once per minute.
