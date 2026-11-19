const { describe, it, beforeEach } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert');

const ROOT = join(__dirname, '..');
const SOLUTION_PATH = join(ROOT, 'solution', 'docs', 'memory-table.md');

describe('memory-table.md validation', () => {
  // Load fixture data
  const priceSheet = JSON.parse(
    readFileSync(join(ROOT, 'fixture', 'price-sheet.json'), 'utf8')
  );
  
  const operatingModel = readFileSync(
    join(ROOT, 'fixture', 'operating-model.md'), 'utf8'
  );
  
  // Parse engine reservation from operating model
  const engineReservationMatch = operatingModel.match(/Engine memory reservation\s*\|\s*(\d+)\s*\|\s*percent/);
  const engineReservationPercent = engineReservationMatch ? parseInt(engineReservationMatch[1]) : 25;
  const engineReservationFraction = engineReservationPercent / 100;
  
  // Calculate expected values
  const expectedValues = priceSheet.nodes.map(node => {
    const usableMemoryGB = node.memory_gb * (1 - engineReservationFraction);
    const pricePerUsableGB = node.monthly_price_usd / usableMemoryGB;
    return {
      id: node.id,
      advertisedMemory: node.memory_gb,
      usableMemory: usableMemoryGB,
      monthlyPrice: node.monthly_price_usd,
      pricePerUsableGB: pricePerUsableGB
    };
  });
  
  let solutionContent = '';
  beforeEach(() => {
    try { solutionContent = readFileSync(SOLUTION_PATH, 'utf8'); } catch (e) { solutionContent = ''; }
    assert.ok(solutionContent.length > 0, 'deliverable missing or empty');
  });
  
  it('should find the solution file', () => {
    try {
      solutionContent = readFileSync(SOLUTION_PATH, 'utf8');
      assert.ok(solutionContent.length > 0, 'Solution file should not be empty');
    } catch (error) {
      assert.fail(`Failed to read solution file: ${error.message}`);
    }
  });
  
  it('should contain a properly formatted table', () => {
    const lines = solutionContent.split('\n');
    const tableLines = lines.filter(line => line.includes('|'));
    
    assert.ok(tableLines.length >= 2, 'Should have at least a header and one data row');
    
    // Check for expected column headers
    const headerLine = tableLines.find(line => 
      line.toLowerCase().includes('node') && 
      line.toLowerCase().includes('memory') && 
      line.toLowerCase().includes('price')
    );
    assert.ok(headerLine, 'Table should have headers mentioning node, memory, and price');
  });
  
  it('should have correct number of data rows (one per node)', () => {
    const lines = solutionContent.split('\n');
    const dataRows = lines.filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.toLowerCase().includes('node') &&
      !line.toLowerCase().includes('id') &&
      line.trim().length > 0
    );
    
    assert.strictEqual(dataRows.length, priceSheet.nodes.length, 
      `Should have exactly ${priceSheet.nodes.length} data rows, one per node`);
  });
  
  it('should have correct values for all nodes', () => {
    const lines = solutionContent.split('\n');
    const dataRows = lines.filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.toLowerCase().includes('node') &&
      !line.toLowerCase().includes('id') &&
      line.trim().length > 0
    );
    
    dataRows.forEach((row, rowIndex) => {
      const columns = row.split('|').map(col => col.trim()).filter(col => col.length > 0);
      
      // Find which node this row corresponds to
      const nodeId = columns.find(col => col.includes('cache-'));
      const expected = expectedValues.find(ev => ev.id === nodeId);
      assert.ok(expected, `Row should correspond to a known node ID, found: ${nodeId}`);
      
      // Extract all numeric values from the row
      const numericValues = columns.map(col => {
        const match = col.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
      }).filter(val => val !== null);
      
      // Should have at least 4 numeric values: advertised memory, usable memory, monthly price, price per GB
      assert.ok(numericValues.length >= 4, `Row should contain at least 4 numeric values`);
      
      // Find which numeric value corresponds to which column by comparing to expected values
      // with 1% tolerance
      const foundAdvertised = numericValues.some(val => 
        Math.abs(val - expected.advertisedMemory) <= expected.advertisedMemory * 0.01
      );
      const foundUsable = numericValues.some(val => 
        Math.abs(val - expected.usableMemory) <= expected.usableMemory * 0.01
      );
      const foundMonthlyPrice = numericValues.some(val => 
        Math.abs(val - expected.monthlyPrice) <= expected.monthlyPrice * 0.01
      );
      const foundPricePerGB = numericValues.some(val => 
        Math.abs(val - expected.pricePerUsableGB) <= expected.pricePerUsableGB * 0.01
      );
      
      assert.ok(foundAdvertised, `Row for ${expected.id} should contain advertised memory ~${expected.advertisedMemory}`);
      assert.ok(foundUsable, `Row for ${expected.id} should contain usable memory ~${expected.usableMemory.toFixed(1)}`);
      assert.ok(foundMonthlyPrice, `Row for ${expected.id} should contain monthly price ~${expected.monthlyPrice}`);
      assert.ok(foundPricePerGB, `Row for ${expected.id} should contain price per GB ~${expected.pricePerUsableGB.toFixed(2)}`);
    });
  });
  
  it('should calculate usable memory correctly (25% engine overhead)', () => {
    const lines = solutionContent.split('\n');
    const dataRows = lines.filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.toLowerCase().includes('node') &&
      !line.toLowerCase().includes('id') &&
      line.trim().length > 0
    );
    
    dataRows.forEach((row, rowIndex) => {
      const columns = row.split('|').map(col => col.trim()).filter(col => col.length > 0);
      const nodeId = columns.find(col => col.includes('cache-'));
      const expected = expectedValues.find(ev => ev.id === nodeId);
      
      // Extract advertised and usable memory values
      const numericValues = columns.map(col => {
        const match = col.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
      }).filter(val => val !== null);
      
      // Find advertised memory (should be one of the original values: 52, 105, or 209)
      const advertised = numericValues.find(val => 
        Math.abs(val - 52) < 0.1 || Math.abs(val - 105) < 0.1 || Math.abs(val - 209) < 0.1
      );
      assert.ok(advertised, `Should find advertised memory value in row`);
      
      // Find usable memory (should be advertised * 0.75)
      const expectedUsable = advertised * 0.75;
      const usable = numericValues.find(val => 
        Math.abs(val - expectedUsable) <= expectedUsable * 0.01
      );
      assert.ok(usable, `Usable memory should be ~${expectedUsable.toFixed(1)} (75% of ${advertised})`);
    });
  });
  
  it('should calculate price per usable GB correctly', () => {
    const lines = solutionContent.split('\n');
    const dataRows = lines.filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.toLowerCase().includes('node') &&
      !line.toLowerCase().includes('id') &&
      line.trim().length > 0
    );
    
    dataRows.forEach((row, rowIndex) => {
      const columns = row.split('|').map(col => col.trim()).filter(col => col.length > 0);
      const nodeId = columns.find(col => col.includes('cache-'));
      const expected = expectedValues.find(ev => ev.id === nodeId);
      
      // Extract numeric values
      const numericValues = columns.map(col => {
        const match = col.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
      }).filter(val => val !== null);
      
      // Find monthly price (should be one of: 420, 650, 1400)
      const monthlyPrice = numericValues.find(val => 
        Math.abs(val - 420) < 1 || Math.abs(val - 650) < 1 || Math.abs(val - 1400) < 1
      );
      assert.ok(monthlyPrice, `Should find monthly price value in row`);
      
      // Find usable memory
      const advertised = numericValues.find(val => 
        Math.abs(val - 52) < 0.1 || Math.abs(val - 105) < 0.1 || Math.abs(val - 209) < 0.1
      );
      const expectedUsable = advertised * 0.75;
      const usable = numericValues.find(val => 
        Math.abs(val - expectedUsable) <= expectedUsable * 0.01
      );
      
      // Calculate expected price per GB
      const expectedPricePerGB = monthlyPrice / expectedUsable;
      
      // Find price per GB in the row
      const pricePerGB = numericValues.find(val => 
        Math.abs(val - expectedPricePerGB) <= expectedPricePerGB * 0.01
      );
      assert.ok(pricePerGB, `Price per usable GB should be ~${expectedPricePerGB.toFixed(2)} (${monthlyPrice} / ${expectedUsable.toFixed(1)})`);
    });
  });
  
  it('should have consistent rounding (monetary to 2 decimals, memory to 1 decimal)', () => {
    const lines = solutionContent.split('\n');
    const dataRows = lines.filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.toLowerCase().includes('node') &&
      !line.toLowerCase().includes('id') &&
      line.trim().length > 0
    );
    
    dataRows.forEach((row, rowIndex) => {
      const columns = row.split('|').map(col => col.trim()).filter(col => col.length > 0);
      
      columns.forEach((col, colIndex) => {
        const match = col.match(/(\d+(?:\.\d+)?)/);
        if (match) {
          const value = match[0];
          // Check if it's a monetary value (likely contains $ or USD)
          if (col.includes('$') || col.toLowerCase().includes('usd')) {
            const decimalPlaces = value.includes('.') ? value.split('.')[1].length : 0;
            assert.ok(decimalPlaces <= 2, 
              `Monetary value "${col}" should have at most 2 decimal places, has ${decimalPlaces}`);
          } else if (col.toLowerCase().includes('gb') || col.toLowerCase().includes('memory')) {
            const decimalPlaces = value.includes('.') ? value.split('.')[1].length : 0;
            assert.ok(decimalPlaces <= 1,
              `Memory value "${col}" should have at most 1 decimal place, has ${decimalPlaces}`);
          }
        }
      });
    });
  });
  
  it('should not contain design recommendations or architecture decisions', () => {
    const forbiddenPhrases = [
      'recommend', 'suggest', 'advise', 'best', 'worst', 'optimal',
      'choose', 'select', 'prefer', 'architecture', 'design', 'decision',
      'should', 'must', 'ought to', 'consider', 'evaluate', 'analysis'
    ];
    
    const lowerContent = solutionContent.toLowerCase();
    const foundPhrases = forbiddenPhrases.filter(phrase => 
      lowerContent.includes(phrase.toLowerCase())
    );
    
    assert.strictEqual(foundPhrases.length, 0,
      `Should not contain design recommendations. Found phrases: ${foundPhrases.join(', ')}`);
  });
  
  it('should reference the correct data sources', () => {
    // Check that the solution mentions the source files
    assert.ok(
      solutionContent.includes('price-sheet.json') || solutionContent.includes('price-sheet'),
      'Should mention price-sheet.json or similar as data source'
    );
    assert.ok(
      solutionContent.includes('operating-model.md') || solutionContent.includes('operating model'),
      'Should mention operating-model.md or similar for engine reservation'
    );
  });
});