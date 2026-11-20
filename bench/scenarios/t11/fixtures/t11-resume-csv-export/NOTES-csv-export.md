# CSV export handoff

The export work is in progress and the checklist below reflects the original handoff. Read the branch history alongside it when making changes.

- [x] Route the export command through a format option.
- [ ] Add one header row with the agreed columns.
- [ ] Keep timestamps in the user's local time.
- [x] Expose the export function from the package entry point.
- [ ] Handle commas, quotes, line breaks, and spreadsheet formula-like values.

Loose notes:
- The first sample used five columns while the shape was being discussed.
- Tags should remain easy to read when opened as a spreadsheet.
- The command should continue to read the normal JSON ledger.
- The export plan neutralizes formula-like cell values with a leading apostrophe, preserving the original value after that prefix.
