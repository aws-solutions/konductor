const { blockOf } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Recommendation section', () => {
  const block = blockOf('docs/framing.md');
  
  it('includes a clear recommendation', () => {
    const recommendation = block.recommendation || '';
    const recText = typeof recommendation === 'string' ? recommendation : JSON.stringify(recommendation);
    
    assert.ok(recText.length > 20, 'Recommendation should be substantive');
    assert.match(recText, /recommend|suggest|propose|advise|start|begin|implement|choose|select/i, 'Should explicitly recommend something');
  });
  
  it('recommends starting with normalization fix', () => {
    const recommendation = block.recommendation || '';
    const recText = typeof recommendation === 'string' ? recommendation : JSON.stringify(recommendation);
    
    assert.match(recText, /normaliz|standardiz|clean|format/i, 'Should mention normalization');
    assert.match(recText, /first|initial|start|begin|phase.?1|quick.?win/i, 'Should indicate starting point');
  });
  
  it('acknowledges phased approach or future evaluation', () => {
    const recommendation = block.recommendation || '';
    const recText = typeof recommendation === 'string' ? recommendation : JSON.stringify(recommendation);
    
    const hasPhased = /phase|stage|step|iterat/i.test(recText);
    const hasFuture = /future|later|next|subsequent|evaluat|re.?assess/i.test(recText);
    
    assert.ok(hasPhased || hasFuture, 'Should mention phased approach or future evaluation');
  });
  
  it('justifies recommendation with evidence', () => {
    const justification = block.justification || '';
    const justificationText = typeof justification === 'string' ? justification : JSON.stringify(justification);
    
    assert.ok(justificationText.length > 30, 'Justification should be substantive');
    assert.match(justificationText, /because|since|as|due.?to|given|evidence|data|analysis/i, 'Should provide reasoning');
  });
});