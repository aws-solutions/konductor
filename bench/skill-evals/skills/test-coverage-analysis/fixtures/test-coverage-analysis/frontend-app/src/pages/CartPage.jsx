import { PriceTag } from '../components/PriceTag';
export function CartPage({ items }) {
  if (items.length === 0) return <p>Your cart is empty. <a href="/products">Keep shopping</a></p>;
  const total = items.reduce((s, i) => s + i.cents * i.qty, 0);
  return (<div>{items.map((i) => <div key={i.id}>{i.name} <PriceTag cents={i.cents * i.qty} /></div>)}<strong>Total <PriceTag cents={total} /></strong></div>);
}
