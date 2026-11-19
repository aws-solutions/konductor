# Leadership memo

As of 2027-04-12. Leadership wants one shared deployment tool for production deployment orchestration across Atlas, Beacon, and Cedar. The target is all in-scope services running on it by 2027-08-27.

The program includes service registration, approvals, production promotion, rollback, and deployment history. It does not include feature flag controls, CI build systems, or data migrations. Deployment audit records must be retrievable for at least 365 days, and the tool must support OIDC sign-in and approval history.

The requested program staffing is 2 dedicated engineers from each product team and 1 engineer from Identity Services.

Suggested checkpoints are tool decision on 2027-05-14, pilot ready on 2027-06-18, first product cutover on 2027-07-30, and all in-scope teams on the shared tool on 2027-08-27.
