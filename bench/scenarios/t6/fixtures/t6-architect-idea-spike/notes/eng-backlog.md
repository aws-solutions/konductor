# Eng backlog scraps (Tomas, whatever is in my head)

Before freeze
- tax rounding fix (ready, needs review)
- park the invoice-numbering cleanup, write the note
- merge Priya's webhook retry change

After freeze (audit/hardening list)
- audit log export
- dependency bumps (Node 24 on workers)
- page-count guard for renderer (from INC-2025-014)
- render cache keyed on invoice hash + template version

Maybe
- PDF thumbnails for the invoice list
- split long statements into parts?? needs product input
- edge for static assets (not PDFs)

Reminder: spike code goes in a branch, not main. Throwaway is fine.
