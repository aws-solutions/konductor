# ADR excerpt: keep validation in the browser

Status: accepted, 2024-11-06

The checkout keeps lightweight format checks in the browser to avoid a round trip for obvious mistakes. It must still submit the original value to the server after trimming only presentation whitespace. The browser module should not attempt to infer a missing country from a postal code. Server errors need a stable field key so the error summary can link back to the input.
