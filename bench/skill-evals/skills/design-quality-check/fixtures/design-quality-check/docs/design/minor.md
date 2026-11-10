# Audit Log Export

## Background

Compliance needs a monthly export of admin actions. Needless to say, the current process is a manual database query that an engineer runs on the first of each month.

## Requirements

1. Export all admin actions for the previous month to CSV.
2. Store the export in the compliance S3 bucket.

## Solution Overview

A scheduled job queries the audit table and writes a CSV to S3. It should be noted that the audit table already has a timestamp index, so the query is a range scan.

## How It Works

See Figure 1 (docs/diagrams/audit-export.png). An EventBridge schedule triggers a Lambda on the first day of each month. As mentioned above, the Lambda queries the timestamp index for the previous month and streams rows to S3 with a multipart upload.

## Implementation Plan

1. Write the export Lambda.
2. Add the EventBridge schedule.
3. In order to verify the output, compare row counts against the audit table for one test month.

## Architecture Decision Records

### ADR-1: Lambda instead of a Glue job

The export is a single range query that finishes in under a minute for one month of data (measured on the March 2026 table: 41 seconds). A Lambda is somewhat simpler to deploy and operate than a Glue job for this size.
