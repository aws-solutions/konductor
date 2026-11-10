# Expense reporting app: high-level design (approved)

Components:
- Web client (React): submit expense, upload receipt, manager approval queue, admin policy screen.
- Expense API (API Gateway + Lambda): CRUD for expense reports and line items.
- Receipt service: presigned S3 upload, OCR via Textract, attaches extracted totals to a line item.
- Approval workflow (Step Functions): routes a submitted report to the submitter's manager,
  escalates after 3 business days, notifies by email (SES).
- Policy engine: per-category spending limits configured by admins; evaluated on submit.
- Reimbursement export: nightly job writes approved reports to a CSV in S3 for the payroll system.

Data (DynamoDB single table): Report, LineItem, Receipt, Approval, Policy.
