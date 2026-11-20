// Changes for this request; see the commit message for the reasoning.
const fs = require('fs');
const content = fs.readFileSync('docs/framing.md', 'utf8');
const match = content.match(/```json\n([\s\S]*?)\n```/);
if (!match) {
  console.error('No JSON block found');
  process.exit(1);
}
try {
  JSON.parse(match[1]);
  console.log('JSON valid');
} catch (e) {
  console.error('JSON invalid:', e.message);
  process.exit(1);
}