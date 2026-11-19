// Simple date helper for sprint calculations
// Node.js 24 compatible, no dependencies

/**
 * Calculate business days between two dates
 * @param {Date} start - Start date
 * @param {Date} end - End date
 * @param {Array} holidays - Array of holiday dates
 * @returns {number} Number of business days
 */
function businessDaysBetween(start, end, holidays = []) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  let count = 0;
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    const dateStr = d.toISOString().split('T')[0];
    
    // Skip weekends
    if (day === 0 || day === 6) continue;
    
    // Skip holidays
    if (holidays.includes(dateStr)) continue;
    
    count++;
  }
  
  return count;
}

/**
 * Calculate team capacity considering time off
 * @param {number} totalDays - Total business days
 * @param {number} teamSize - Number of team members
 * @param {number} reducedCapacityDays - Days at reduced capacity
 * @param {number} reducedCapacityPercent - Percentage during reduced days
 * @returns {number} Adjusted team capacity in person-days
 */
function calculateCapacity(totalDays, teamSize, reducedCapacityDays = 0, reducedCapacityPercent = 100) {
  const normalDays = totalDays - reducedCapacityDays;
  const normalCapacity = normalDays * teamSize;
  const reducedCapacity = reducedCapacityDays * teamSize * (reducedCapacityPercent / 100);
  return normalCapacity + reducedCapacity;
}

module.exports = { businessDaysBetween, calculateCapacity };