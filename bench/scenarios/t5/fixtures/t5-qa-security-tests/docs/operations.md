# Operations notes

A login account has a short window for failed password attempts. Successful authentication clears the account's failure state. Audit events are kept in memory by the local handler harness and are shipped by the edge adapter in production.
