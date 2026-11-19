# Account baseline

This repository keeps the access shape for the shared sandbox account. The JSON under `iam/` is reviewed with the account configuration and is consumed by the deployment job.

## Local commands

The project has no install step and uses only Node.js built-ins.

```sh
node src/validate.js
node --test
```

The validator checks the four policy documents and prints a short account summary. The examples use documentation-only account identifiers and do not grant access to a real account.

Group responsibilities and the names used by the policies are in `docs/`. The permissions boundary is attached to group roles by the account bootstrap process.
