function makeOrder(input, pricing, reservation, payment) {
  return {
    id: input.id,
    email: input.email,
    lines: input.lines,
    ...pricing,
    reservation,
    payment,
    state: 'paid'
  };
}

module.exports = { makeOrder };
