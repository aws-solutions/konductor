export function compactDate(value) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }
export function capitalize(value) { return String(value).charAt(0).toUpperCase() + String(value).slice(1); }
