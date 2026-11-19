# Examples

A short script can read bookings and ask whether a proposed time is free:

```js
const { readBookings } = require('../src/bookings');
const { isAvailable } = require('../src/availability');

const bookings = readBookings('data/bookings.json');
console.log(isAvailable(bookings, '2025-04-14T13:00:00', '2025-04-14T14:00:00'));
```
