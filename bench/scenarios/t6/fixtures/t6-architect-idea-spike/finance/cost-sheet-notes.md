# Cost sheet notes (Ines, 8 Sep)

`cost-sheet.csv` is PDF-related spend only, taken from the monthly cloud bill. Compute is the 4 render workers plus a share of the queue.

- Volume grows roughly 3% a month.
- The June bump in compute was the memory increase on the workers after the incident.
- Storage and egress are small. I would not expect an edge move to change the total by more than a few hundred dollars a month either way, and it is not why we are looking at it.
- No new vendor spend before the freeze lifts (see Marguerite's email). Free tier only.

If someone wants a per-PDF cost: total / pdf_requests, about half a cent.
