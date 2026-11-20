function formatEventDate(date) { const value = date instanceof Date ? date : new Date(date); return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value); }
function isWeekend(date) { const day = (date instanceof Date ? date : new Date(date)).getUTCDay(); return day === 0 || day === 6; }
if (typeof module !== 'undefined') module.exports = { formatEventDate, isWeekend };
