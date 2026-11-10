import { render } from '@testing-library/react';
import { Button } from '../components/Button';
test('Button renders', () => {
  const { container } = render(<Button count={1} cents={100}>x</Button>);
  expect(container.firstChild).toBeTruthy();
});
test('Button matches snapshot', () => {
  const { container } = render(<Button count={2} cents={250}>y</Button>);
  expect(container).toMatchSnapshot();
});
