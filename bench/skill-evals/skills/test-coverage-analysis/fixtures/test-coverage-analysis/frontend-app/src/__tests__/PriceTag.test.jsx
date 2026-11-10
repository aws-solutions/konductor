import { render } from '@testing-library/react';
import { PriceTag } from '../components/PriceTag';
test('PriceTag renders', () => {
  const { container } = render(<PriceTag count={1} cents={100}>x</PriceTag>);
  expect(container.firstChild).toBeTruthy();
});
test('PriceTag matches snapshot', () => {
  const { container } = render(<PriceTag count={2} cents={250}>y</PriceTag>);
  expect(container).toMatchSnapshot();
});
