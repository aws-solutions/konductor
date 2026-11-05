# orders-infra

Infrastructure for a small orders service.

- `template.yaml`: CloudFormation stack with the API, the function, the Orders table and the upload bucket.
- `policies/support-role.json`: the permissions policy for the support team role.

## Requirements

- The upload bucket is private. Only the function reads and writes objects under the `uploads/` prefix.
- The function reads and writes the Orders table and nothing else.
- The support team can read orders and read uploaded files. It cannot change any other resource and cannot manage identities.
- Data is encrypted at rest. The Orders table can be restored to a point in time and cannot be deleted by a stack update by accident.
- Secrets are not stored in the template or in environment variables as plain text.
- Every API method requires authentication.
- Access to hosts is limited to the office network range 10.20.0.0/16.
- Logs are kept for 90 days.
