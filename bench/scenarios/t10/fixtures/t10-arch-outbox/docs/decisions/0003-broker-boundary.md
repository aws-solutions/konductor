# Decision 0003: broker boundary

The order service depends on a tiny adapter instead of a vendor client. The adapter accepts a topic and message and may reject a publish.
