// Tests for date-helper.js
// Run with: node --test date-helper.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { businessDaysBetween, calculateCapacity } = require('./date-helper.js');

describe('date-helper', () => {
  describe('businessDaysBetween', () => {
    it('calculates business days excluding weekends', () => {
      const start = new Date('2025-01-06'); // Monday
      const end = new Date('2025-01-10');   // Friday
      assert.equal(businessDaysBetween(start, end), 5);
    });

    it('excludes holidays', () => {
      const start = new Date('2025-01-01'); // Wednesday (holiday)
      const end = new Date('2025-01-03');   // Friday
      const holidays = ['2025-01-01'];
      assert.equal(businessDaysBetween(start, end, holidays), 2);
    });

    it('handles single day', () => {
      const date = new Date('2025-01-06');
      assert.equal(businessDaysBetween(date, date), 1);
    });
  });

  describe('calculateCapacity', () => {
    it('calculates normal capacity', () => {
      assert.equal(calculateCapacity(10, 5), 50); // 10 days * 5 people
    });

    it('accounts for reduced capacity days', () => {
      assert.equal(calculateCapacity(10, 5, 2, 60), 46); // 8 days * 5 + 2 days * 5 * 0.6
    });

    it('handles zero reduced capacity days', () => {
      assert.equal(calculateCapacity(10, 5, 0, 50), 50);
    });
  });
});