# parcel-sieve

`parcel-sieve` converts a directory of UTF-8 notes into JSON records. It is deliberately small enough to use in a shell script and predictable enough to use in a nightly import.

## Command line

```text
node bin/sieve.js --input ./notes --output ./records --concurrency 2 --retries 1
```

The command reads regular `.txt` files, in name order, and writes a matching `.json` file for each one. A successful run prints the number of records. Missing arguments return status 2; an input or output error returns status 1.

The library entry point is `src/index.js`. `runPipeline(inputDir, outputDir, options, callback)` reports `{ processed, files }`, where each file has `source` and `output` names. `processFile(inputFile, outputDir, options, callback)` handles one file. `retry(operation, options, callback)` retries an error-first operation, with `options.retries` counting additional attempts. `new FileStore()` provides `readText(file, callback)`, `writeJson(file, value, callback)`, and `ensureDir(dir, callback)`.

Callbacks use the Node error-first shape. The examples above show the callback form used by older consumers.
