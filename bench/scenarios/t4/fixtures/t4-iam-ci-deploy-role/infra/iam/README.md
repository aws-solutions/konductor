# Deployment permissions

The CI job uses the policy in this directory as the identity policy for the deployment role. Resource names are kept in the stage configuration files so a release can be reproduced without editing the workflow.

The policy document is JSON and is checked by the deployment account's policy tooling before it is attached.
