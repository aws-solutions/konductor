# Release control note

The customer-data control requires a failed production release to be reverted or stopped within **12 minutes** of the release health signal. The release owner must preserve the UTC event time and the health signal in the change record.

Stopping further exposure counts as an immediate containment step. A full binary revert still follows the service runbook.
