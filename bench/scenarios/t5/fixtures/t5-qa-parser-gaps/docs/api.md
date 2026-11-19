# API

`parse(text)` returns a plain object. Quantity values have `value`, `unit`,
and a `to(unit)` method. `validate(config)` returns `{ valid, errors }`.
`parseAndValidate(text)` parses and throws `ValidationError` when the result
is invalid. `print(config)` returns normalized source text.

Errors include a one-based line and column. The command-line wrapper reads a
file, validates it, and writes the normalized form to standard output.
