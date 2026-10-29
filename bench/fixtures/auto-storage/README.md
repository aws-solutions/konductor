# file-vault

Documents live as plain files under `storage/`. `storage/index.json` is the only record of which files belong
to which owner. See `docs/STORAGE.md` for the layout.

```js
const { readIndex, referencedFiles } = require('./src');

readIndex('storage');        // [{ id: 'd1', file: 'blobs/inv-2025-01.txt', owner: 'ana', ... }]
referencedFiles('storage');  // Set { 'blobs/inv-2025-01.txt', ... }
```

## Scripts

- `node scripts/usage.js [storageDir]` prints the size of each folder under `storage/`.

## Layout

- `src/store.js` index and file helpers
- `src/paths.js` path helpers that keep everything inside the storage directory
- `src/report.js` folder sizes
- `scripts/` command line tools
