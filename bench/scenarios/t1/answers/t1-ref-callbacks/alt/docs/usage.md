# Usage notes

The input folder is scanned once. Names ending in `.txt` are selected case-sensitively and sorted before work begins. The output folder is created when necessary.

The `--concurrency` value controls how many files may be active at once. It defaults to two. `--retries` controls additional write attempts and defaults to zero.

A record contains the source basename, its non-empty lines, line count, word count, and character count. The JSON is formatted with two-space indentation so it is friendly to reviews.

## Async API

All exported operations support both callback and promise modes:

```javascript
const { runPipeline, processFile, retry, FileStore } = require('parcel-sieve');

// Promise mode
const result = await runPipeline(inputDir, outputDir, { concurrency: 3 });

// Callback mode
runPipeline(inputDir, outputDir, { concurrency: 3 }, (err, result) => {
  if (err) console.error(err);
  else console.log(result);
});
```

The FileStore methods (`readText`, `writeJson`, `ensureDir`) also support both modes. When a callback is provided, it is guaranteed to be called exactly once, even on errors, and promise rejections are handled internally to prevent unhandled rejection warnings.
