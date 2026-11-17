'use strict';

const { createBookingService, createStore, createFakePayments, createNotifier, loadEvents } = require('../src');

async function main() {
  const service = createBookingService({ store: createStore(), payments: createFakePayments(), notifier: createNotifier(), events: loadEvents() });
  console.log(await service.book('workshop', 'ada'));
  console.log('free seats:', await service.remaining('workshop'));
}

main();
