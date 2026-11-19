# Operations notes

The service is designed for one small process per environment. JSON stores are enough for local development but should be replaced before horizontal scaling.

Set `NODE_ENV` to select a config file. Keep the deployment token secret outside the repository and rotate it during a planned maintenance window. Logs are line-delimited JSON so the platform can collect them without parsing application output.
