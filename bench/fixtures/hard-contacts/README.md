# contacts-core

An in-memory contacts service, a request handler shaped like an HTTP API, and a CSV export.

```js
const { createContactService } = require('./src');

const contacts = createContactService();
contacts.create({ fullName: 'Ada Lovelace', email: 'ada@example.com' });
contacts.search('ada');
contacts.exportCsv();
```

Contacts have `id`, `fullName`, `email` and `phone`. See `docs/API.md` for the field table, the handler
routes and the CSV format.

## Layout

- `src/service.js` the service (`create`, `get`, `update`, `list`, `search`, `exportCsv`)
- `src/model.js` input validation and `ValidationError`
- `src/repo.js` storage and the search index
- `src/serialize.js` JSON and CSV output
- `src/http.js` `handleRequest`
- `src/cli.js` prints the seed contacts
- `data/seed.json` sample contacts
