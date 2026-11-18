# Product notes: reports

- Report pages show charts and a table. They load from the reporting service.
- CSV export exists since release 4.2. It sits under Settings > Advanced > Data tools, not on the report page.
- The report page has a browser print button (`pdf_print_clicks` in the usage file counts it). It was hidden by a
  CSS change in release 4.6 and nobody noticed.
- Engineering estimate for PDF export of every report page: 6 to 8 weeks for two engineers, plus a rendering
  service to run.
- Moving the CSV export button onto the report page: about 2 days.
- `data/tickets.csv` holds every support ticket about reports from October. `category` was set by the support team.
- `data/usage.csv` holds weekly usage of the report pages for the same month.
