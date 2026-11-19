# Logging rules

Logs are for operations, not customer support exports. Do not print full card
fingerprints, card numbers, authentication tokens, or customer email addresses.
Use a request id, merchant id, order id, and a short event name. If a provider
reference is needed, log its last four characters only.

Errors should carry context in structured fields so the message stays useful
without copying a request body.
