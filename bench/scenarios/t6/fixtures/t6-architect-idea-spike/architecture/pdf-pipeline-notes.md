# PDF pipeline notes (Tomas, scratch, Aug)

Renderer is `leafpress`, our own lib. Takes the invoice JSON + template, lays out pages, serialises to PDF.

What I have seen in profiles (laptop and prod, a handful of runs, not rigorous):

- Layout is CPU-bound. For a long statement about 85% of the wall time is CPU in layout and serialisation. The rest is fetching fonts and the tenant logo, which are cached in the worker after the first job (cold start adds roughly half a second).
- Time grows about linearly with page count. Short invoices are dominated by fixed work (template load, fonts, storage write).
- Memory: the whole page tree is held until serialisation, so memory also grows with page count. I did not measure it carefully until the June incident; table is in the postmortem.
- Output size: ~60 KB per page for text-only, more with logos on every page.

Things I have NOT looked at
- whether layout can be split across workers by page range (would need page breaks decided up front)
- font subsetting cost
- how it behaves with less than 256 MB. Never tried.

Bundling: leafpress + deps is pure JS, no native modules, so in principle it runs anywhere with Node-compatible APIs. Fonts are loaded from files; I'd need to check how that works on a platform with no disk.
