const { blockOf, requirementTexts, itemTexts } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Comprehensive insights from analysis', () => {
  const block = blockOf('docs/framing.md');
  
  it('identifies root cause as data normalization not search engine', () => {
    const analysis = block.analysis || '';
    const analysisText = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    
    const mentionsRootCause = 
      /root.?cause|core.?problem|real.?issue|underlying/i.test(analysisText) &&
      /normaliz|format|data.?clean|standardiz/i.test(analysisText);
    
    const mentionsNotEngine = 
      /not.?engine|not.?search.?engine|engine.?problem|wrong.?problem/i.test(analysisText);
    
    assert.ok(mentionsRootCause || mentionsNotEngine, 
      'Should identify root cause as data normalization, not search engine deficiency');
  });
  
  it('considers business impact and support costs', () => {
    const reqTexts = requirementTexts(block);
    const analysis = block.analysis || '';
    const analysisText = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    
    const allText = reqTexts.join(' ') + ' ' + analysisText;
    
    assert.match(allText, /business.?impact|cost|roi|return/i, 'Should consider business impact');
    assert.match(allText, /support.?cost|ticket.?cost|hour|labor/i, 'Should consider support costs');
  });
  
  it('balances technical solution with business needs', () => {
    const options = block.options || [];
    const optionTexts = itemTexts(options);
    const analysis = block.analysis || '';
    const analysisText = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    
    const hasTechnical = optionTexts.some(text => /technical|engineer|code|develop/i.test(text));
    const hasBusiness = optionTexts.some(text => /business|cost|roi|support|customer/i.test(text));
    const balances = /balance|balances|trade.?off|tradeoff/i.test(analysisText);
    
    assert.ok(hasTechnical && hasBusiness, 'Should consider both technical and business aspects');
    assert.ok(balances || (hasTechnical && hasBusiness), 'Should balance or acknowledge both aspects');
  });
  
  it('proposes measurable outcomes with timeframe', () => {
    const measure = block.measure || {};
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    
    assert.match(measureText, /measur|metric|kpi|outcome|result/i, 'Should propose measurable outcomes');
    
    // Check for timeframe or iteration mention
    const hasTimeframe = /week|month|quarter|phase|iteration|timeline/i.test(measureText);
    const justification = block.justification || '';
    const justificationText = typeof justification === 'string' ? justification : JSON.stringify(justification);
    const hasTimeInJustification = /week|month|quarter|phase|iteration|timeline/i.test(justificationText);
    
    assert.ok(hasTimeframe || hasTimeInJustification, 'Should mention timeframe or iteration');
  });
});