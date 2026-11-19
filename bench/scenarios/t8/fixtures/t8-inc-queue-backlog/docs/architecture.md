# Notification path

`notify-api` accepts an event and publishes it to `notify.events`. The broker retains the event by partition. Consumers A, B, and C share the delivery-notification group; each acknowledges an event only after the push gateway accepts it. The gateway returns a request ID that is logged by the consumer.

The consumer payload contract currently calls the destination field `recipient` and the configured type is a scalar string. Consumer A owns partition 2 during the period covered by these records.
