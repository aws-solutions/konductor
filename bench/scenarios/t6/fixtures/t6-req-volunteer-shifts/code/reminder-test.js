// Test for reminder timing logic
// This prototype helped us think through reminder timing

function calculateReminders(shiftTime) {
  const shiftDate = new Date(shiftTime);
  
  // 48 hours before
  const reminder48h = new Date(shiftDate);
  reminder48h.setHours(reminder48h.getHours() - 48);
  
  // 24 hours before  
  const reminder24h = new Date(shiftDate);
  reminder24h.setHours(reminder24h.getHours() - 24);
  
  // Morning of (8 AM local time)
  const morningOf = new Date(shiftDate);
  morningOf.setHours(8, 0, 0, 0);
  
  return {
    shift: shiftDate.toISOString(),
    reminders: {
      fortyEightHours: reminder48h.toISOString(),
      twentyFourHours: reminder24h.toISOString(),
      morningOf: morningOf.toISOString()
    }
  };
}

// Test cases
console.log('Test 1 - Normal shift (March 20, 10:00 AM):');
console.log(calculateReminders('2024-03-20T10:00:00'));

console.log('\nTest 2 - Evening shift (March 21, 6:00 PM):');
console.log(calculateReminders('2024-03-21T18:00:00'));

console.log('\nTest 3 - Weekend shift (March 23, 9:00 AM):');
console.log(calculateReminders('2024-03-23T09:00:00'));

// Issues identified:
// 1. Time zone handling - times are in local time but stored as UTC
// 2. Night shift volunteers - 8 AM reminder might wake them
// 3. Weekend shifts - should we send reminders at different times?
// 4. Last-minute sign-ups - how to handle reminders?