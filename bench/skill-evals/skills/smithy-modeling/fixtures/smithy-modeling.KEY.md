# Key: smithy-modeling fixture
api.txt: namespace com.acme.logistics; zip pattern 5 digits; weightGrams @range(min:1,max:70000); recipientPhone @sensitive; list paginated max 50;
status enum; errors 404, 400, 409 (cancel not allowed), 429.
model-draft/inventory.smithy defects: namespace not reverse-DNS ("inventory"); snake_case members (item_id, display_name, supplier_api_key);
PutItem missing @http; GetItem not @readonly; DeleteItem not @idempotent; ListItems not @paginated; no error shapes; @httpLabel members not @required;
no documentation; supplier_api_key not @sensitive; qty no @range.
v2 notes:
- @httpLabel members must be @required (Smithy validation error otherwise).
- Renaming item_id/display_name/supplier_api_key to camelCase changes the restJson wire names; for a model that has
  already shipped clients, a strong answer calls this out as breaking or keeps wire names with @jsonName. The draft has
  no generated clients yet (per prompt), so renaming is fine if the trade-off is noted.
- PutItem has no URI/label: a reasonable fix is PUT /items/{itemId} with @idempotent.
- api.txt cancel conflict (409) applies to DeleteShipment only; 429 throttling should be on every operation or the service.
- api.txt "newest first" implies a documented sort order on the list output.
