# Decision: storage boundary

We keep persistence behind a narrow repository interface so a memory store can exercise application behavior without a service dependency. The production adapter owns retries and the application owns validation.
