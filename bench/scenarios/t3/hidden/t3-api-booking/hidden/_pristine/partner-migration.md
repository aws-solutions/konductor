# Partner migration note

A partner's archived integration guide used an offset query and allowed a page size of **500**. The document was written for gateway generation 1 and is **superseded by the current gateway contract** in `requirements.md`; it must not be copied into the new public contract.

The partner still sends room identifiers as opaque strings and expects date-time values with an offset. Preserve those data-shape expectations where they do not conflict with the current service requirements. The partner's old retry behavior is the reason the create operation needs an idempotency key.
