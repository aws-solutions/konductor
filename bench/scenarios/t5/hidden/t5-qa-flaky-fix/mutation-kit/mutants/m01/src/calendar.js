const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function partsInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function weekdayFor(instant, timeZone = process.env.TZ || 'UTC') {
  const short = partsInZone(instant, timeZone).weekday;
  return WEEKDAYS.find(day => day.startsWith(short));
}

function localParts(instant, timeZone = process.env.TZ || 'UTC') {
  const parts = partsInZone(instant, timeZone);
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

function isDue(rule, instant = new Date(), timeZone = process.env.TZ || 'UTC') {
  const local = localParts(instant, timeZone);
  return weekdayFor(instant, timeZone) === rule.weekday && local.hour === rule.hour && local.minute === rule.minute;
}

function nextOccurrence(rule, instant = new Date(), timeZone = process.env.TZ || 'UTC') {
  const start = new Date(instant.getTime());
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
    const local = localParts(candidate, timeZone);
    if (weekdayFor(candidate, timeZone) === rule.weekday && (offset > 0 || local.hour > rule.hour || (local.hour === rule.hour && local.minute >= rule.minute))) {
      const result = new Date(candidate);
      result.setUTCMinutes(result.getUTCMinutes() + (rule.hour - local.hour) * 60 + rule.minute - local.minute);
      return result;
    }
  }
  throw new Error('could not find next occurrence');
}

function ruleFromText(text) {
  const match = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error('invalid reminder rule');
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour >= 23 || minute > 59) throw new Error('invalid reminder rule');
  return { weekday: match[1], hour, minute };
}

module.exports = { weekdayFor, localParts, isDue, nextOccurrence, ruleFromText };
