# Jobs

`inventory.sync` accepts `{ "warehouse": "west" }` and updates inventory for that warehouse.

`shipment.create` accepts `{ "orderId": "order-123" }` and sends the order to the shipping system.

Unknown job types are reported in the worker log and do not stop the process from examining later jobs.
