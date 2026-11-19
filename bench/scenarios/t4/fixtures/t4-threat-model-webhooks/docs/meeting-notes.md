# Design meeting notes

**Date:** 2025-02-12  
**Attendees:** relay working group  
**Topic:** first hosted version

The group agreed to keep partner adapters out of the core service. Each adapter will normalize its event into the common envelope before the request reaches the relay. The first release can use one region and a managed relational database.

Operations wants a health endpoint and a queue depth graph before customer onboarding. Product wants callback registration to remain self-service. The callback owner should be able to update a URL without opening a support ticket. The team will document an operational contact for failed deliveries rather than adding a second notification channel in the prototype.

The retention target is thirty days because customers use the event history for reconciliation. A later review will decide whether payload redaction is needed for particularly sensitive partner event types. Until then, the examples use synthetic invoice data and documentation-only account identifiers.

The group also agreed that the edge proxy will remain the single public TLS entry point and that service instances will only accept traffic from the private network. The database adapter remains the place for query construction so application modules do not concatenate SQL strings.
