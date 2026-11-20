# Harborline Orders

Harborline is a small order service for the Northstar checkout group. It records orders and payment status in a local JSON store and sends status changes to the in-process broker adapter.

## Local development

Node 24 is required. There are no packages to install. Run npm test and the two checks in scripts. The service is normally started by the host process, which supplies a data file and a broker.

## Public modules

The order domain is in src/orders.js; storage, broker, and HTTP boundaries are separate so small tools can use them without starting a server.

## Operating assumptions

A data file belongs to one service instance at a time. Production runs two instances for availability.
