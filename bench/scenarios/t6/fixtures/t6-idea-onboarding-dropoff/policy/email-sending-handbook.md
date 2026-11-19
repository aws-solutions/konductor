# Transactional email handbook excerpt

Sender-domain changes are production changes even when the app UI does not change. Before a change, Messaging records the old and new domain, provider mix, delivery rate, bounce rate, and a rollback contact. For the first two weeks, review these by provider rather than only in aggregate.

A delivery failure needs a provider response code or a reproducible message trace before it is called a content problem. A missing analytics event is an instrumentation problem until the service ledger and backend record disagree.

The handbook does not prescribe a product change. It says to establish whether the message reached the mailbox before changing the signup experience.
