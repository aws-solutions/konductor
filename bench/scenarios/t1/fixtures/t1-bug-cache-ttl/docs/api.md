# Lookup API

`createApp` accepts profile and permission arrays and returns transport-neutral `profile` and `permissions` functions. A request has an `id` string. Responses have `status` and `body` fields.

Unknown records return status 404. A request without a non-empty id returns status 400. Successful profile bodies contain the stored profile fields; successful permission bodies contain an id and a roles array.
