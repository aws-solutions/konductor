# Provider signatures

The source provider sends `x-source-signature` as `sha256=<hex>` and includes
`x-source-timestamp` plus `x-source-delivery` on every delivery. The signature
covers the exact UTF-8 request bytes. A delivery is acceptable only when its
timestamp is no more than 300 seconds from the service clock and its delivery
identifier has not been seen during that window.

The billing provider uses `x-billing-signature` with the same envelope shape.
The two providers have separate signing secrets in production, although the
local adapter can use one value. Header names are case-insensitive.

The public key identifier `pub_demo_2025_01` identifies the non-secret key set
used by the dashboard. It is safe to include in ordinary diagnostic output.
