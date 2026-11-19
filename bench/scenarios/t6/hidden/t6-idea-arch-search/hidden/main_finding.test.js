const { blockOf } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Main finding about search queries', () => {
  const block = blockOf('docs/framing.md');
  
  it('states that most searches are part-number lookups', () => {
    const reqs = block.requirements || [];
    const text = reqs.map(r => typeof r === 'string' ? r : r?.text || '').join(' ');
    assert.match(text, /part.?number|part.?no|pn|partnum/i, 'Should mention part number searches');
    // Accept "most", "majority", or numerical indication (like 65%)
    const hasMajorityWord = /most|majority|primarily|mainly|largely/i.test(text);
    const hasMajorityNumber = /6[0-9]%|7[0-9]%|over.?half|more.?than.?half/i.test(text);
    assert.ok(hasMajorityWord || hasMajorityNumber, 'Should indicate majority (word or 60%+ number)');
  });
  
  it('states part-number searches fail due to formatting issues', () => {
    const reqs = block.requirements || [];
    const text = reqs.map(r => typeof r === 'string' ? r : r?.text || '').join(' ');
    assert.match(text, /format|dash|space|leading.?zero|separator|variation/i, 'Should mention formatting issues');
    assert.match(text, /fail|not.?work|problem|issue|broken/i, 'Should indicate failure');
  });
  
  it('states text searches are smaller share but work better', () => {
    const reqs = block.requirements || [];
    const text = reqs.map(r => typeof r === 'string' ? r : r?.text || '').join(' ');
    assert.match(text, /text|description|word|phrase/i, 'Should mention text searches');
    assert.match(text, /smaller|minority|less|secondary|subset/i, 'Should indicate smaller share');
    assert.match(text, /work.?better|higher.?success|better.?performance/i, 'Should indicate better performance');
  });
});