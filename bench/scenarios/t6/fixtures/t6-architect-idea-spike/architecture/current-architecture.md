# Ledgerleaf architecture overview (Tomas, updated Aug 2025)

## Shape

- Web app + public API (Node 22, containers, main region).
- Postgres for invoices, customers, tenants. Invoice rows hold a JSON body (lines, taxes, notes). A "statement" is a monthly invoice with up to a few hundred lines per customer, and it is the only kind that gets long.
- Queue (managed) with 4 render workers. Each worker is a container with 1 GB of memory (was 256 MB until the June incident).
- Object storage for finished PDFs. Download links are signed URLs valid for 15 min.

## PDF request path

1. User clicks Download, or an email job needs an attachment.
2. API checks the invoice, puts a render job on the queue (or returns the stored PDF when the invoice has not changed since the last render).
3. A worker picks the job, runs the renderer, writes the PDF to storage, and tells the API.
4. The browser polls the API every 500 ms until the PDF is ready, then follows the signed URL.

Details of the renderer are in `pdf-pipeline-notes.md` and `adr-0007-renderer-choice.md`.

## Other services

- Email sender, webhook dispatcher, nightly exports. None of them are in scope for anything PDF-related except the email attachment job.
- Observability: render service writes one log line per job; we export those to CSV for analysis.

## Known gaps

- No streaming render: a PDF is built in memory and written once.
- Cache only covers unchanged invoices; statements change often during the month.
- No per-tenant concurrency limits.
