# Internal API shape

The package accepts one order-line record at a time. Identifiers are strings, dates are supplied by the caller, and monetary amounts use integer cents. Transport adapters should translate their own request format before calling the domain module.

Errors are ordinary JavaScript errors with a stable machine-readable code where the domain needs one. Callers should not depend on error messages.
