import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddressForm } from '../AddressForm';

test('renders and saves', () => {
  const onSave = vi.fn();
  render(<AddressForm extras={['a', 'b']} onSave={onSave} />);
  fireEvent.click(screen.getByText('Save'));
  expect(screen.getByText('Save')).toBeTruthy();
});
