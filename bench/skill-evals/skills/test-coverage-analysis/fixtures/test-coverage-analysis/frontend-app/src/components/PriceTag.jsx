export function PriceTag({ cents }) {
  return <span>${(cents / 100).toFixed(2)}</span>;
}
