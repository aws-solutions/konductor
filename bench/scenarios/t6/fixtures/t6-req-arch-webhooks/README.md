# Ledgerline Payments project notes

This is a working folder for the Ledgerline Payments platform. The `src/events` module is the small part of the service that currently turns internal changes into named events. Product, support, security, and operations notes are mixed in with exports from the last planning cycle.

The material predates a decision about outbound webhooks. It is intentionally a little untidy: meeting notes are not authoritative, exports contain old rows, and `docs/` contains both policy and design material. Use the current API and security documents as the strongest sources when they conflict with a casual note.

The event module has no third-party dependencies. Run its checks with `node --test` from this folder.
