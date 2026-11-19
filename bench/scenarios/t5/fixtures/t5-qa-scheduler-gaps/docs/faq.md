# FAQ

## Does the queue reorder equal priorities?

No. Items with the same numeric priority leave in insertion order.

## What happens when a state file is damaged?

The reader returns an empty mapping and lets the caller decide what to persist.
