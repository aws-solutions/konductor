# Design Document: CSV Export

## Overview

TypeScript, Node 20, existing Express API. Jobs are stored in the existing `jobs` table
through `JobRepository`. Files go to object storage through the existing `BlobStore` interface.

## Components

- `ExportController` - `POST /projects/:projectId/exports`, `GET /exports/:exportId`.
- `ExportService` - creates jobs, enforces the 50,000 task limit, checks admin and workspace membership.
- `CsvWriter` - streams rows; handles RFC 4180 escaping and formula-injection prefixing.
- `ExportWorker` - picks up QUEUED jobs, pages tasks 1,000 at a time, writes via `CsvWriter` to `BlobStore`, marks READY or FAILED.
- `SignedUrlProvider` - wraps `BlobStore.signedUrl(key, ttlSeconds)`.

## Data model

`ExportJob { id, projectId, workspaceId, requestedBy, status: QUEUED|RUNNING|READY|FAILED, blobKey?, error?, createdAt }`

## Error handling

- Over-limit -> 422 `EXPORT_TOO_LARGE`.
- Worker failure -> status FAILED with `error`; no automatic retry in v1.

## Testing strategy

Unit tests for CsvWriter and ExportService; integration tests for the controller with an in-memory BlobStore.
