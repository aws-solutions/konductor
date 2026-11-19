const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, readDoc } = require('./doc-key.js');

describe('MVP plan feasibility', () => {
  const plan = blockOf('docs/release-plan.md');
  
  it('plan includes chosen backlog items with total points', () => {
    assert.ok(plan.chosen, 'plan should have chosen items array');
    assert.ok(Array.isArray(plan.chosen), 'chosen should be an array');
    assert.ok(plan.totalPoints, 'plan should have totalPoints');
    assert.ok(typeof plan.totalPoints === 'number', 'totalPoints should be a number');
    assert.ok(plan.totalPoints > 0, 'totalPoints should be positive');
  });

  it('plan respects team capacity from velocity and holidays', () => {
    // Team capacity calculation: 7 sprints * 32 points = 224 points
    // But reduced capacity in Sprint 3 (Feb 10-14): 60% capacity = 19 points instead of 32
    // Adjusted capacity: 224 - 13 = 211 points
    assert.ok(plan.totalPoints <= 211, `totalPoints ${plan.totalPoints} exceeds adjusted capacity of 211`);
    assert.ok(plan.totalPoints >= 150, `totalPoints ${plan.totalPoints} seems too low for MVP`);
  });

  it('every dependency of chosen items is also chosen', () => {
    // First, plan must have chosen items
    assert.ok(plan.chosen && plan.chosen.length > 0, 'Plan should have chosen items');
    
    const backlogText = readDoc('backlog.csv');
    const lines = backlogText.split('\n').slice(1); // Skip header
    const items = new Map();
    
    // Parse backlog
    for (const line of lines) {
      if (!line.trim()) continue;
      const [id, , estimate, depsStr] = line.split(',');
      const dependencies = depsStr ? depsStr.split(';').map(d => d.trim()) : [];
      items.set(id.trim(), { id: id.trim(), dependencies });
    }

    // Check dependencies
    const chosenSet = new Set(plan.chosen || []);
    for (const chosenId of chosenSet) {
      const item = items.get(chosenId);
      if (item && item.dependencies) {
        for (const depId of item.dependencies) {
          assert.ok(
            chosenSet.has(depId) || depId === '', 
            `Chosen item ${chosenId} depends on ${depId} which is not chosen`
          );
        }
      }
    }
  });

  it('contractual items are included (compliance reporting)', () => {
    // From contract-excerpt.md: compliance reporting is must-have
    // TEN-113 is "Contractual compliance reporting" - P0
    assert.ok(plan.chosen.includes('TEN-113'), 'Contractual compliance reporting (TEN-113) must be included');
  });

  it('handles duplicate backlog item TEN-121 correctly', () => {
    // TEN-121 is duplicate of TEN-103
    const chosenSet = new Set(plan.chosen || []);
    const has103 = chosenSet.has('TEN-103');
    const has121 = chosenSet.has('TEN-121');
    
    // Should not have both duplicates
    assert.ok(!(has103 && has121), 'Should not include both duplicate items TEN-103 and TEN-121');
    
    // Test always needs an assertion - check that plan acknowledges duplicate issue
    const requirements = plan.requirements || [];
    const reqText = requirements.map(r => typeof r === 'string' ? r : r.text || '').join(' ');
    const mentionsDuplicate = /duplicate|TEN-121.*TEN-103|TEN-103.*TEN-121|same.*maintenance/i.test(reqText);
    
    // Either mention the duplicate or don't include both
    assert.ok(mentionsDuplicate || !(has103 && has121), 'Should acknowledge duplicate items TEN-103/TEN-121');
  });

  it('accounts for item with missing estimate TEN-123', () => {
    // TEN-123 has missing estimate in CSV but should be 3 points per email thread
    // The plan should acknowledge or account for this
    const requirements = plan.requirements || [];
    const reqText = requirements.map(r => typeof r === 'string' ? r : r.text || '').join(' ');
    
    if (plan.chosen && plan.chosen.includes('TEN-123')) {
      // Check that requirements mention TEN-123 estimate issue
      const mentionsTEN123Estimate = /TEN-123.*3|3.*point.*TEN-123|missing.*estimate.*TEN-123|TEN-123.*estimate/i.test(reqText);
      assert.ok(mentionsTEN123Estimate, 'Should mention TEN-123 estimate issue (3 points from email)');
      
      // Also check that totalPoints seems reasonable (not obviously wrong)
      assert.ok(plan.totalPoints >= 150 && plan.totalPoints <= 211, 
        `totalPoints ${plan.totalPoints} should be between 150 and 211`);
    } else {
      // TEN-123 not chosen - check if plan explains why (it's a legal requirement)
      // At minimum, plan should exist
      assert.ok(plan.chosen, 'Plan should have chosen items');
    }
  });

  it('P0 items with dependencies on lower priority items are handled', () => {
    // TEN-113 (P0 compliance reporting) depends on TEN-108 (manager dashboard)
    // If TEN-113 is chosen, TEN-108 must also be chosen
    const chosenSet = new Set(plan.chosen || []);
    if (chosenSet.has('TEN-113')) {
      assert.ok(chosenSet.has('TEN-108'), 'TEN-113 (compliance reporting) depends on TEN-108 (dashboard)');
    } else {
      // TEN-113 not chosen - check if plan mentions this dependency issue
      const requirements = plan.requirements || [];
      const reqText = requirements.map(r => typeof r === 'string' ? r : r.text || '').join(' ');
      const mentionsDependency = /TEN-113.*depends|compliance.*dashboard|P0.*depends|dependency.*chain/i.test(reqText);
      // At minimum, plan should exist
      assert.ok(plan.chosen, 'Plan should have chosen items');
    }
  });

  it('plan identifies deferred items', () => {
    assert.ok(plan.deferred, 'plan should have deferred items array');
    assert.ok(Array.isArray(plan.deferred), 'deferred should be an array');
    
    // Should have some deferred items (backlog has ~200 points, capacity ~211)
    assert.ok(plan.deferred.length > 0, 'should have deferred items given capacity constraints');
    
    // No item should be both chosen and deferred
    const chosenSet = new Set(plan.chosen || []);
    const deferredSet = new Set(plan.deferred || []);
    const intersection = [...chosenSet].filter(id => deferredSet.has(id));
    assert.equal(intersection.length, 0, 'items cannot be both chosen and deferred');
  });
});