# Northstar integrations

This repository holds the small amount of configuration shared by the platform team when external services connect to Northstar. IAM documents live under `infra/roles/`, while account records and onboarding notes live under `config/` and `docs/`.

## Local checks

The project targets Node.js 24 and has no runtime dependencies. Run the unit suite with:

```sh
npm test
```

The policy file checker can be run separately:

```sh
npm run check:iam
```

Example account numbers in this repository are documentation values. They are not production credentials.
