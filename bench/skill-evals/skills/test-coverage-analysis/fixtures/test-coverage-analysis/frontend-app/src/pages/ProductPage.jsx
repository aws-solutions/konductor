import { useState } from 'react';
import { Button } from '../components/Button';
import { CartBadge } from '../components/CartBadge';
export function ProductPage({ product }) {
  const [count, setCount] = useState(0);
  return (<div><h1>{product.name}</h1><CartBadge count={count} /><Button onClick={() => setCount(count + 1)}>Add to cart</Button></div>);
}
