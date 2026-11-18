# Problem framing: getting report data out

## Problem

Users cannot find how to get their report data out of the product. A missing PDF format is a smaller problem.

- 41 of the 66 October report tickets (62%) ask where to download or export report data
  (`category` = `cant-find-export` in `data/tickets.csv`). Only 9 (14%) ask for PDF.
- CSV export already exists, but it sits under Settings > Advanced > Data tools, not on the report page
  (`docs/product-notes.md`).
- About 1,200 users are active each week and 34 to 38 click export, about 3% (`data/usage.csv`).
- Print clicks are 0 every week. That is not a lack of demand: the print button was hidden by a CSS change in
  release 4.6 (`docs/product-notes.md`).

Who has it: report users who need data in a file, often finance teams. The 10 tickets about slow reports (15%) are a
separate problem and are left out here.

## Options

### Option 1: do nothing

Cost: none. Leaves all 41 findability tickets a month and the hidden print button.

### Option 2: move the CSV export onto the report page and restore the print button

Cost: about 2 days. Addresses the 41 findability tickets and gives a printable page. Leaves the 9 PDF requests
partly open.

### Option 3: build PDF export as requested

Cost: 6 to 8 weeks for two engineers plus a rendering service. Addresses the 9 PDF tickets. Leaves the 41 users who
cannot find the export that exists, unless the new button is also on the report page.

### Option 4: option 2 now, then decide on PDF from the new numbers

Cost: 2 days now, a decision in six weeks.

## Recommendation

Option 4: move the export button onto the report page, restore print, and measure before planning PDF.

## Success measure

- `cant-find-export` tickets: from 41 a month to under 10 a month by the end of December, read from the support
  ticket export.
- Export clicks: from about 3% of weekly active users to at least 10% within six weeks, read from `data/usage.csv`.

## Assumptions to test first

- Users who file `cant-find-export` tickets want CSV, not PDF. Test: ask the next 10 such tickets which format.
- Printing covers most PDF needs. Test: count print clicks after the fix.

Stop signal: if PDF requests stay above 8 a month six weeks after the fix, revisit option 3. If findability
tickets do not fall below 20 a month, stop and look again at the report page.

## Open questions

- Does sales have lost deals that name PDF? The request says competitors have it but gives no deal count.
