# Money values

`Money` stores an integer called `minor` and a three-letter currency code. For USD, `105` means 105 cents. For JPY, `105` means 105 yen because that currency has no fractional minor unit.

Use `Money.fromMinor(value, currency)` for construction. Addition, subtraction, and comparison require the same currency. Formatting is kept separate from arithmetic so a display locale cannot change a stored value.
