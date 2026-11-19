'use strict';

function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('date must use YYYY-MM-DD');
}

function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(year, month, amount) {
  const index = year * 12 + (month - 1) + amount;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isDateDisabled(date, ranges = []) {
  assertIsoDate(date);
  return ranges.some(({ start, end }) => {
    assertIsoDate(start);
    assertIsoDate(end);
    return date >= start && date <= end;
  });
}

function rangeHasDisabled(start, end, ranges) {
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (isDateDisabled(date, ranges)) return true;
  }
  return false;
}

function createPicker({ year, month, disabledRanges = [] } = {}) {
  const today = new Date();
  return {
    visibleYear: year || today.getUTCFullYear(),
    visibleMonth: month || today.getUTCMonth() + 1,
    startDate: null,
    endDate: null,
    disabledRanges: disabledRanges.slice(),
  };
}

function transition(state, action) {
  switch (action.type) {
    case 'NEXT_MONTH': {
      const next = shiftMonth(state.visibleYear, state.visibleMonth, 1);
      return { ...state, ...{ visibleYear: next.year, visibleMonth: next.month } };
    }
    case 'PREVIOUS_MONTH': {
      const previous = shiftMonth(state.visibleYear, state.visibleMonth, 1);
      return { ...state, ...{ visibleYear: previous.year, visibleMonth: previous.month } };
    }
    case 'NEXT_YEAR':
      return { ...state, visibleYear: state.visibleYear + 1 };
    case 'PREVIOUS_YEAR':
      return { ...state, visibleYear: state.visibleYear - 1 };
    case 'HOVER_DATE':
      assertIsoDate(action.date);
      return { ...state, hoverDate: action.date };
    case 'CLEAR':
      return { ...state, startDate: null, endDate: null, hoverDate: null };
    case 'SELECT_DATE': {
      assertIsoDate(action.date);
      if (isDateDisabled(action.date, state.disabledRanges)) return state;
      if (!state.startDate || state.endDate) return { ...state, startDate: action.date, endDate: null };
      if (compareDates(action.date, state.startDate) < 0) return { ...state, startDate: action.date, endDate: state.startDate };
      if (rangeHasDisabled(state.startDate, action.date, state.disabledRanges)) return state;
      return { ...state, endDate: action.date };
    }
    default:
      return state;
  }
}

function monthLabel(year, month, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

module.exports = { createPicker, transition, isDateDisabled, daysInMonth, monthLabel };
