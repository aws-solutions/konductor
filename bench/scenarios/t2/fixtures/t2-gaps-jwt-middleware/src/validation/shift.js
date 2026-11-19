function shiftInput(value) {
  const required = ['date', 'start', 'end', 'assignee'];
  if (!value || required.some((key) => typeof value[key] !== 'string' || value[key] === '')) return { ok: false, reason: 'date, times and assignee are required' };
  return { ok: true, value: { ...value, notes: value.notes || '' } };
}
module.exports = { shiftInput };
