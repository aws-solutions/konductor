# CSV Export: approved user stories

## US-1 Export filtered results
As an operations analyst, I want to export the currently filtered device list to CSV, so that I can share it with finance.

- Given I have applied filters
  When I choose Export
  Then the file downloads quickly
- Then the CSV includes all visible columns

## US-2 Large exports
As an operations analyst, I want large exports to still work, so that I don't have to split my filters.

- Given the result has many rows
  When I choose Export
  Then the system handles it in the background and tells me when it's ready
- Given the export job fails
  Then I get a notification

## US-3 Export permissions
As a security admin, I want exports limited to authorized roles, so that device data does not leak.

- Given the user lacks the export permission
  When they choose Export
  Then it is blocked
