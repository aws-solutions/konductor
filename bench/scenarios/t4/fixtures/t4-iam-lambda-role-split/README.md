# Lantern Order Service

Lantern is a small example order service with separate entry points for order creation, payment notifications, fulfilment, reporting, and exports. It runs on Node.js 24 without third-party packages.

## Local commands

```sh
npm test
node scripts/verify-config.js
```

The local cloud client records requests instead of contacting a provider. Stage names are `staging` and `prod`; account and resource values are examples only.
