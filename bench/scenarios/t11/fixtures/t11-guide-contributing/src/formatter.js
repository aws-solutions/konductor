'use strict';
function format(entries) {
  return entries.map((entry) => {
    const suffix = entry.label ? ' | ' + entry.label : '';
    return entry.at + ' ' + entry.text + suffix;
  }).join('\n');
}
module.exports = { format };
