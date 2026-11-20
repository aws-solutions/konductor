'use strict';

// Price bands by weight in kg (upper bound inclusive), per service.
const BANDS = [
  { upTo: 1, standard: 4.9, express: 9.9 },
  { upTo: 2, standard: 6.9, express: 12.9 },
  { upTo: 5, standard: 9.4, express: 16.4 },
  { upTo: 10, standard: 14.9, express: 24.9 },
  { upTo: 30, standard: 22.5, express: 39.5 },
];

/** The price of a parcel of `kg` kilograms with `service`. */
function priceFor(kg, service) {
  if (typeof kg !== 'number' || !(kg > 0)) throw new Error(`bad weight: ${kg}`);
  const band = BANDS.find((b) => kg <= b.upTo);
  if (!band) throw new Error(`too heavy: ${kg} kg`);
  if (!Object.hasOwn(band, service)) throw new Error(`unknown service: ${service}`);
  return band[service];
}

module.exports = { priceFor, BANDS };
