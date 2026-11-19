# Managed delivery service limits

The production quota sheet gives a maximum of **3,000 messages per second per queue**. The quota applies independently to each queue, so a design that needs more capacity must use additional queues or a different service shape. A topic and its regional queues still count each regional queue separately.

The broker accepts payloads up to 4096 bytes. The notification contract in `traffic.csv` is smaller than that service maximum and is the hard data-size target for this review.

For orientation, an old sandbox page listed 2,500 messages per second per queue. That sandbox figure is superseded by the production quota stated above and is not a production constraint.
