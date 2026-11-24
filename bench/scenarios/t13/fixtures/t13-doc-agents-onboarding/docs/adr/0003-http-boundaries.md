# ADR 0003: HTTP boundaries

The HTTP layer owns status codes and serialization. Domain functions return
plain values and do not write to a response object.
