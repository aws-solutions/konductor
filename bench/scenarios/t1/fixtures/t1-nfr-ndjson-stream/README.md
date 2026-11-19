# Logjob

Logjob turns newline-delimited request logs into a compact endpoint report. It is a small standard-library utility used by the nightly operations job.

## Quick start

```sh
python3 -m logjob --input data/sample.ndjson --output reports/sample.json
```

The input is one JSON object per line. The report contains counts, server-error counts, and latency percentiles for each endpoint. Input files are normally kept in `data/`; generated reports belong in `reports/`.

Development uses Python 3.12 and the standard library. Run the test suite with:

```sh
python3 -m unittest discover -s tests -v
```
