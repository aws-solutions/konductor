# Changelog

## Unreleased

- Internal: moved the duplicated rounding and zip helpers into `src/util.js` and renamed the carrier `calcBase` function to `baseRate`. No change to quotes or the public API.

## 1.2.0

- Added the freight carrier for parcels over 30 kg.

## 1.1.0

- Added the express carrier.
- Quotes now come back cheapest first.

## 1.0.0

- First release: standard carrier, address cleanup and zones.
