# Order event data classification

_Owner: Data Governance. Effective 2024-09-01._

The platform classifies event fields independently of the system that emits them. A partner may receive only fields marked **Partner-shareable** by an approved contract. Fields marked **Personal data** require a documented purpose, an approved recipient, and the minimum field set for that purpose.

| Field | Class | Partner-shareable by default | Notes |
| --- | --- | --- | --- |
| `event_id` | Platform identifier | Yes | Stable identifier for delivery tracking |
| `tenant_id` | Tenant metadata | No | Use partner mapping rather than exposing the internal tenant key |
| `order_id` | Business identifier | Yes | Contract may restrict retention |
| `status` | Business state | Yes | Values are documented in the event schema |
| `occurred_at` | Operational timestamp | Yes | UTC ISO-8601 |
| `customer_name` | Personal data | No | Full name is not part of the standard partner set |
| `customer_email` | Personal data | No | Requires a separate approved purpose |
| `shipping_address` | Personal data | No | Includes street, locality, postal code, and country |
| `billing_country` | Low-risk account data | Contract-dependent | Only the country code may be shared |
| `currency` | Business data | Yes | ISO 4217 code |
| `total_amount` | Financial business data | Contract-dependent | Partner contract determines whether it is included |

The standard order webhook profile is `order.status.v1`. Its approved field set is `event_id`, `order_id`, `status`, `occurred_at`, `currency`, and a contract-approved `total_amount`. The profile does not include customer contact or address fields.

Data Governance records an approved purpose and recipient in the contract register. A service may not infer approval from a partner's subscription to an event type. Field-level policy checks are expected at the point where a payload is assembled.
