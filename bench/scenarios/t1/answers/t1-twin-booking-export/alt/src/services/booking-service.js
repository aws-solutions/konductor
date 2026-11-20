const { HttpError } = require('../errors');
const { validateBooking } = require('../utils/validation');
const { nextBookingId } = require('../utils/ids');

class BookingService {
  constructor(store) {
    this.store = store;
  }

  list(range = {}) {
    const bookings = this.store.all();
    if (!range.from && !range.to) return bookings;
    return bookings.filter(booking => {
      if (range.from && booking.date < range.from) return false;
      if (range.to && booking.date > range.to) return false;
      return true;
    });
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
}

module.exports = { BookingService };
