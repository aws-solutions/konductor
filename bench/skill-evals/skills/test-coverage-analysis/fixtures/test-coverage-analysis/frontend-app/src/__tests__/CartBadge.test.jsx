import { render } from '@testing-library/react';
import { CartBadge } from '../components/CartBadge';
test('CartBadge renders', () => {
  const { container } = render(<CartBadge count={1} cents={100}>x</CartBadge>);
  expect(container.firstChild).toBeTruthy();
});
test('CartBadge matches snapshot', () => {
  const { container } = render(<CartBadge count={2} cents={250}>y</CartBadge>);
  expect(container).toMatchSnapshot();
});
