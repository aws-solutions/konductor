const { blockOf, itemTexts } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Analysis of solution options', () => {
  const block = blockOf('docs/framing.md');
  
  it('includes option of fixing normalization in database', () => {
    const options = block.options || [];
    const optionTexts = itemTexts(options);
    
    const hasNormalization = optionTexts.some(text => 
      /normaliz|standardiz|clean|format|dash|space|zero/i.test(text) && 
      /database|postgres|sql|current|existing/i.test(text)
    );
    
    assert.ok(hasNormalization, 'Should include option to fix normalization in current database');
  });
  
  it('includes option of dedicated search engine', () => {
    const options = block.options || [];
    const optionTexts = itemTexts(options);
    
    const hasDedicatedEngine = optionTexts.some(text => 
      /dedicated|separate|special|full|proper|engine|algolia|elastic|search.?as.?a.?service/i.test(text)
    );
    
    assert.ok(hasDedicatedEngine, 'Should include option for dedicated search engine');
  });
  
  it('compares costs and benefits of options', () => {
    const analysis = block.analysis || '';
    const analysisText = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    
    assert.match(analysisText, /cost|price|expense|investment/i, 'Should discuss costs');
    assert.match(analysisText, /benefit|advantage|pro|strength/i, 'Should discuss benefits');
    assert.match(analysisText, /trade.?off|compare|versus|vs\.?|alternative/i, 'Should compare options');
  });
  
  it('mentions support ticket reduction as key benefit', () => {
    const analysis = block.analysis || '';
    const analysisText = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    
    assert.match(analysisText, /support.?ticket|ticket.?volume|complaint|issue/i, 'Should mention support tickets');
    assert.match(analysisText, /reduc|decreas|lower|fewer|improve/i, 'Should mention reduction');
  });
});