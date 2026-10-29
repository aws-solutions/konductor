# Changelog

## Unreleased

- Add `format: 'csv'` to `renderReport`.
- Format EUR amounts as `1.234,56 €` in the text report.
- Split the renderer into calculation, money and layout modules. Text output is unchanged.

## 2.1.0

- Notes are word-wrapped at 60 columns.
- Add the `width` option.

## 2.0.0

- Free shipping above a subtotal of 100.
