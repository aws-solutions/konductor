# HLD: Member Profiles

The web app calls the Profile API (`GET /members/{id}`, `PATCH /members/{id}`). The Profile API is a Lambda behind API Gateway with a Cognito authorizer and reads and writes the `members` DynamoDB table. Only the owner (Cognito `sub` equal to `id`) may read or write a profile.
