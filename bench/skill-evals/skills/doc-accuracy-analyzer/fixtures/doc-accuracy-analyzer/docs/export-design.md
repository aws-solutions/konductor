# Customer Order Export: Design

## 1. Summary

Customers can download all of their orders as a CSV file from the order
dashboard. The export runs on demand and the file is returned in the same HTTP
response, so we do not need a separate download flow.

## 2. Request path

1. The dashboard calls `GET /orders/export` on our existing REST API in Amazon
   API Gateway.
2. API Gateway invokes the existing order API Lambda function.
3. The Lambda calls `exportOrders()` in `src/exporter.js`, which already streams
   rows to S3 using multipart upload.
4. The Lambda reads the finished file back and API Gateway streams it to the
   browser.

## 3. Sizing

Our largest customer export is about 1.2 GB (see `perf/export-timings.csv`).
Lambda's `/tmp` storage gives us plenty of room for files of this size.

Exports complete in about 40 seconds, based on the timings in
`perf/export-timings.csv`, which is well within the API's limits.

## 4. Reliability

Failed exports are retried three times by the job scheduler in
`src/scheduler.js`.

Exports are rate limited per customer, so one customer cannot starve the
others.

## 5. Plan

No new infrastructure is needed. We expect to ship in one week.
