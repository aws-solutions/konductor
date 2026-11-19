# Architecture notes

The HTTP adapter is deliberately small. A future worker can consume the same notification service without changing provider adapters. Queue state is in memory because this service only handles short-lived development jobs.
