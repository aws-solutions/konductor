# #login-ops export

**2025-02-14T10:30:00Z — mila (on-call)**
Morning handoff is quiet. Watching the password-reset campaign queue.

**2025-02-14T10:49:00Z — release-bot**
Deployment `rel-8421` started for atlas-auth in eu-west-1 and us-east-1.

**2025-02-14T10:55:00Z — release-bot**
Deployment `rel-8421` completed successfully in both regions.

**2025-02-14T11:04:00Z — pager**
Alert: eu-west-1 login success rate below 95% for five minutes.

**2025-02-14T11:07:00Z — mila (on-call)**
EU login errors are climbing. US dashboard is normal. Comparing request IDs and the regional paths now.

**2025-02-14T11:18:00Z — mila (on-call)**
The auth release rollback has started in both regions.

**2025-02-14T11:26:00Z — mila (on-call)**
The auth release rollback completed in both regions. EU failures continue, so the rollback did not change the symptom.

**2025-02-14T11:31:00Z — devon**
The gateway panel shows repeated failed handshakes to auth-eu. I am checking the regional service records.

**2025-02-14T11:36:00Z — mila (on-call)**
The EU pool is isolated while we verify the next routing step.

**2025-02-14T11:40:00Z — mila (on-call)**
Mitigation applied: route eu-west-1 login traffic through the healthy us-east-1 auth pool.

**2025-02-14T11:42:00Z — pager**
EU success-rate alert recovered after the routing change. Keeping the override while replacing the regional credential.

**2025-02-14T12:05:00Z — devon**
A replacement credential is staged for the EU gateway.

**2025-02-14T12:11:00Z — mila (on-call)**
The EU gateway handshake check is green. Normal routing can be restored after the hold period.

**2025-02-14T13:00:00Z — mila (on-call)**
Customer traffic is normal in both regions.
