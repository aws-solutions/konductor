# task-service

Lambda-style handlers for a task tracker. Layers, top to bottom:

- `src/handlers/*` - entry points. Parse the event, call the facade, shape the response.
- `src/facades/taskFacade.js` - orchestrates service calls.
- `src/services/*` - business logic. Always created through `src/services/factory.js`.
- `src/repositories/*` - the only code allowed to touch `src/db.js`.

`src/db.js` is an in-memory stand-in for the DynamoDB document client. It supports
conditional writes through `opts.condition` (`{ attr, equals }` or `{ exists: false }`)
and throws `ConditionalCheckFailedError` when the condition fails. `put` and `update`
return the item as written.

Run tests with `npm test` (Node's built-in test runner, no dependencies).
