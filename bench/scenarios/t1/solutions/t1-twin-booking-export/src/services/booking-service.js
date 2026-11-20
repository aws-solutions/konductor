const { HttpError } = require('../errors');
const { validateBooking } = require('../utils/validation');
const { nextBookingId } = require('../utils/ids');

class BookingService {
  constructor(store) {
    this.store = store;
  }

  list() {
    return this.store.all();
  }

  find(id) {
    const booking = this.store.get(id);
    if (!booking) throw new HttpError(404, 'booking_not_found', 'Booking was not found');
    return booking;
  }

  create(input) {
    const problem = validateBooking(input);
    if (problem) throw new HttpError(400, 'invalid_booking', problem);
    return this.store.insert({ id: nextBookingId(), room: input.room.trim(), date: input.date, owner: input.owner.trim() });
  }

  remove(id) {
    if (!this.store.remove(id)) throw new HttpError(404, 'booking_not_found', 'Booking was not found');
  }

  exportBookings(from, to) {
    let bookings = this.store.all();
    if (from) {
      bookings = bookings.filter(b => b.date >= from);
    }
    if (to) {
      bookings = bookings.filter(b => b.date <= to);
    }
    return bookings;
  }
}

module.exports = { BookingService };