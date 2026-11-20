# Development notes

Keep pricing functions free of browser globals. Dates passed to pricing code should be explicit so a receipt can be reproduced later. New data files should use the same minor-unit convention as the cart.

The sample store does not persist a cart between processes. The in-memory store exists for the small demo shell and for tests.
