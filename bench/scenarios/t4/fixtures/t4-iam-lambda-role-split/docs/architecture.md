# Architecture

Five entry points share a small request wrapper. The webhook places accepted payments on the fulfilment queue. The worker updates shipment state and can send a failed receipt to a dead-letter queue. Reports and exports write separate object prefixes.
