const customers = new Map([
  ['cus_44', { id: 'cus_44', name: 'Mina Park', email: 'mina.park@example.test', phone: '+1-555-0104' }],
  ['cus_45', { id: 'cus_45', name: 'Jon Bell', email: 'jon.bell@example.test', phone: '+1-555-0105' }]
]);

export class CustomerStore {
  get(id) {
    const customer = customers.get(id);
    return customer ? structuredClone(customer) : null;
  }
}
