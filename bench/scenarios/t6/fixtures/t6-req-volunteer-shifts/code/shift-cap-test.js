// Test script for shift cap validation
// This was used to test spreadsheet formulas - keeping for reference

// Note: Shift caps need to be defined based on site capacity
// Currently testing logic only

function validateShift(site, currentCount, cap) {
  if (!cap) {
    return { valid: false, error: `No cap defined for: ${site}` };
  }
  
  if (currentCount >= cap) {
    return { valid: false, error: `Shift cap reached for ${site} (${cap} volunteers)` };
  }
  
  return { valid: true, remaining: cap - currentCount };
}

// Example usage
console.log('Testing shift cap validation logic:');
console.log('Note: Actual caps need to be defined per site');