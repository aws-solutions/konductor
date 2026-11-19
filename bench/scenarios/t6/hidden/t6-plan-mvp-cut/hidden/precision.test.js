const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, numbersIn, readDoc } = require('./doc-key.js');

describe('Precision and reasoning', () => {
  const plan = blockOf('docs/release-plan.md');
  const planText = readDoc('docs/release-plan.md') || '';
  
  it('explains reasoning for capacity calculation', () => {
    const requirements = plan.requirements || [];
    const reqText = requirements.map(r => typeof r === 'string' ? r : r.text || '').join(' ');
    
    // Should mention capacity calculation factors
    const hasVelocity = /velocity|32|points per sprint/i.test(reqText);
    const hasHolidays = /holiday|vacation|reduced capacity|60%/i.test(reqText);
    const hasTimeline = /14 weeks|7 sprints|April 15|deadline/i.test(reqText);
    
    assert.ok(hasVelocity || hasHolidays || hasTimeline, 
      'Should explain capacity calculation (velocity, holidays, timeline)');
  });

  it('identifies the critical dependency chain issue', () => {
    const requirements = plan.requirements || [];
    const reqText = requirements.map(r => typeof r === 'string' ? r : r.text || '').join(' ');
    
    // Should mention the P0 item depending on other feature
    const hasDependencyIssue = /TEN-113.*TEN-108|compliance.*dashboard|P0.*depends|contractual.*dependency/i.test(reqText);
    
    assert.ok(hasDependencyIssue, 'Should identify the P0 dependency issue (TEN-113 depends on TEN-108)');
  });

  it('notes the duplicate backlog item', () => {
    const requirements = plan.requirements || [];
    const reqText = requirements.map(r => typeof r === 'string' ? r : r.text || '').join(' ');
    
    const hasDuplicateNote = /duplicate|TEN-121|TEN-103.*same|maintenance.*request.*twice/i.test(reqText);
    
    assert.ok(hasDuplicateNote, 'Should note the duplicate backlog item (TEN-121/TEN-103)');
  });

  it('uses numbers from provided documents, not invented ones', () => {
    const requirements = plan.requirements || [];
    const reqTexts = requirements.map(r => typeof r === 'string' ? r : r.text || '');
    
    // Allowed numbers from documents (key numbers that matter for planning)
    const allowedNumbers = new Set([
      // From backlog.csv estimates
      '13', '8', '5', '21', '3', '2',
      // From velocity-history.csv and capacity calculations
      '32', '35', '28', '33', '31', '34', '30', '31.9', '4.9', '224', '211', '209',
      // From team calendar and analysis
      '60', '14', '7', '200', '210',
      // From contract and dates
      '15', '75', '24', '72', '99.9', '7', '2025', '6', '10', '14',
      // Simple arithmetic results (difference, buffer, etc.)
      '13', '2', '5'
    ]);
    
    // Also allow numbers that appear in the requirements text as references to backlog items
    // like TEN-101, TEN-102, etc. These are IDs, not invented metrics
    const backlogIdRegex = /TEN-(\d{3})/g;
    
    let inventedCount = 0;
    let totalNumbers = 0;
    
    for (const text of reqTexts) {
      const numbers = numbersIn(text);
      totalNumbers += numbers.length;
      
      // Remove backlog ID numbers from count (TEN-101, etc.)
      const idNumbers = new Set();
      let match;
      while ((match = backlogIdRegex.exec(text)) !== null) {
        idNumbers.add(match[1]);
      }
      
      for (const num of numbers) {
        // Skip if it's a backlog ID reference
        if (idNumbers.has(num)) continue;
        
        // Skip small numbers that could be dates, counts, etc.
        if (parseInt(num) <= 15 && !allowedNumbers.has(num)) {
          // Check if it might be a reasonable number (like day of month, sprint count, etc.)
          continue;
        }
        
        if (!allowedNumbers.has(num)) {
          inventedCount++;
          console.log(`Invented number: ${num} in text: ${text.substring(0, 100)}...`);
        }
      }
    }
    
    // Be more lenient - allow 70% precision
    const precision = totalNumbers > 0 ? (totalNumbers - inventedCount) / totalNumbers : 1;
    assert.ok(precision >= 0.7, `At least 70% of numbers should be from documents. Precision: ${(precision*100).toFixed(1)}% (${inventedCount} invented out of ${totalNumbers})`);
  });

  it('plan has reasonable number of chosen items', () => {
    const chosenCount = plan.chosen ? plan.chosen.length : 0;
    // Backlog has 25 items, with ~211 point capacity
    // Average ~8.5 points per item, so ~25 items would be ~212 points
    // But we need to defer some items
    assert.ok(chosenCount >= 10, `Only ${chosenCount} chosen items seems too few for MVP`);
    assert.ok(chosenCount <= 20, `${chosenCount} chosen items seems too many for capacity`);
  });

  it('plan structure is complete', () => {
    assert.ok(plan.chosen, 'missing chosen array');
    assert.ok(plan.deferred, 'missing deferred array');
    assert.ok(plan.totalPoints, 'missing totalPoints');
    assert.ok(plan.requirements, 'missing requirements array');
    
    assert.ok(Array.isArray(plan.chosen), 'chosen should be array');
    assert.ok(Array.isArray(plan.deferred), 'deferred should be array');
    assert.ok(Array.isArray(plan.requirements), 'requirements should be array');
    
    assert.ok(plan.requirements.length >= 3, 'should have at least 3 requirements/insights');
  });
});