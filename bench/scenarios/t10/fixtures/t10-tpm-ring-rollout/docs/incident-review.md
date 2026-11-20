# Delivery incident review

A provider timeout caused duplicate delivery attempts during a short outage. The follow-up added an idempotency key to the delivery port and made retry counts visible in diagnostics.
