# Glossary

**Accepted** means the partner endpoint returned a response that the delivery service classifies as successful. It does not mean that the partner finished processing the event.

**Connection** means one tenant's relationship with one partner, including the selected webhook profile, destination, and credential reference.

**Delivery attempt** means one HTTP request made for one event and one connection.

**Event Router** is the shared service that reads committed order events and publishes them to internal consumers.

**Partner Delivery** is the proposed service that schedules, sends, and records outbound requests to partner endpoints.

**Partner Registry** is the tenant-scoped configuration service for partner connections.

**Terminal classification** means a delivery state that will not be retried, such as an expired event or a response the policy classifies as permanently rejected.

**Webhook profile** is a named versioned selection of event fields and event types sent to a partner.
