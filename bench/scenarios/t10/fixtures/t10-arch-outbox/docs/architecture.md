# Architecture overview

The HTTP adapter validates input and calls the order domain. The domain reads and writes through the JSON store. The broker adapter is deliberately small and can be replaced by the host process.

The store file contains named collections. A complete replacement of the file is made through the atomic write helper. The service currently keeps orders and payment records in separate domain operations.

Two long-running service instances share the operational contract but normally receive different requests.
