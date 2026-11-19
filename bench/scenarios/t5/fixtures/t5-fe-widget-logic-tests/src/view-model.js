'use strict';

const { monthLabel } = require('./date-range-picker');
const { firstError } = require('./validation');

function pickerViewModel(state, locale = 'en-US') {
  return {
    month: monthLabel(state.visibleYear, state.visibleMonth, locale),
    startDate: state.startDate,
    endDate: state.endDate,
    hoverDate: state.hoverDate || null,
    hasRange: Boolean(state.startDate && state.endDate),
  };
}

function bookingViewModel({ form, picker, pricing }) {
  const error = firstError(form);
  return {
    dates: pickerViewModel(picker),
    total: pricing.totalLabel,
    canSubmit: form.valid && Boolean(picker.startDate && picker.endDate),
    message: error || pricing.message || null,
  };
}

module.exports = { pickerViewModel, bookingViewModel };
