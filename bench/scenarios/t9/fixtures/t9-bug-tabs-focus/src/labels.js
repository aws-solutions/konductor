const labels = new Map([
  ['general', 'General'],
  ['alerts', 'Alerts'],
  ['team', 'Team'],
  ['billing', 'Billing'],
]);

function sectionLabel(key) {
  return labels.get(key) || 'Section';
}

module.exports = { sectionLabel };
