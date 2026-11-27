# Roman numerals

`src/roman.js` exports `toRoman(n)` and `fromRoman(s)`.

## toRoman(n)

- `n` must be an integer from 1 to 3999. Anything else (0, negatives, 4000, `2.5`, a string) throws a `RangeError`.
- Returns the standard form in upper case, with the subtractive pairs `IV`, `IX`, `XL`, `XC`, `CD` and `CM`:
  `toRoman(1994)` is `MCMXCIV`, `toRoman(3999)` is `MMMCMXCIX`, `toRoman(4)` is `IV`.

## fromRoman(s)

- `s` must be a string; anything else throws a `TypeError`.
- Upper and lower case are both accepted, and spaces around the numeral are ignored (`' mcmxciv '` is 1994).
- Only the standard form is accepted: the string must be exactly what `toRoman` returns for its value.
  `IIII`, `IC`, `VX`, `MMMM`, `XXC` and the empty string throw a `SyntaxError` whose message contains the input.
- Returns the integer value.

The two functions are inverses: for every n from 1 to 3999, `fromRoman(toRoman(n)) === n`.
