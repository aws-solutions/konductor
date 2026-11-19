# Design notes

The scheduler walks calendar fields from coarse to fine so a sparse yearly rule
does not require a minute-by-minute scan. Queue sequence numbers are separate from
job priorities, which makes FIFO behavior explicit for ties.

State writes use a sibling temporary file followed by replacement. Reads treat a
missing, empty, malformed, or non-object JSON document as an empty state.
