const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');

const R = path.join(__dirname, '..');
const SOLUTION_DIR = path.join(R, 'solution');
const ADR_PATH = path.join(SOLUTION_DIR, 'docs/adr/0001-queue.md');

describe('ADR document validation', () => {
  const adrContent = fs.readFileSync(ADR_PATH, 'utf8');

  describe('Document structure', () => {
    it('should follow ADR template format', () => {
      // Check for required sections
      const sections = [
        '# ADR',
        '## Status',
        '## Context', 
        '## Decision Drivers',
        '## Considered Options',
        '## Decision',
        '## Consequences',
        '## Implementation Notes',
        '## Compliance'
      ];
      
      sections.forEach(section => {
        assert(
          adrContent.includes(section),
          `Missing section: ${section}`
        );
      });
    });

    it('should have decision block with correct info string', () => {
      const decisionBlockRegex = /^```decision\r?\n[\s\S]*?\r?\n```/m;
      assert(
        decisionBlockRegex.test(adrContent),
        'Missing fenced code block with info string "decision"'
      );
    });

    it('should have proper status', () => {
      const statusMatch = adrContent.match(/## Status\s*\n([^\n]+)/);
      assert(statusMatch, 'Missing status section');
      const status = statusMatch[1].trim();
      assert(['Accepted', 'Proposed', 'Superseded'].includes(status), `Invalid status: ${status}`);
    });
  });

  describe('Content quality', () => {
    it('should explain the problem context', () => {
      const contextSection = adrContent.match(/## Context\s*\n([\s\S]*?)(?=\n## )/);
      assert(contextSection, 'Missing context section');
      const context = contextSection[1];
      
      // Should mention key numbers
      assert(context.includes('11 million'), 'Should mention 11 million daily events');
      assert(context.includes('90KB'), 'Should mention 90KB message size');
      assert(context.includes('400'), 'Should mention 400 events/second peak');
      assert(context.includes('$900'), 'Should mention $900 budget');
    });

    it('should list decision drivers', () => {
      const driversSection = adrContent.match(/## Decision Drivers\s*\n([\s\S]*?)(?=\n## )/);
      assert(driversSection, 'Missing decision drivers section');
      const drivers = driversSection[1];
      
      // Should mention key criteria
      assert(drivers.includes('Cost'), 'Should mention cost as decision driver');
      assert(drivers.includes('Throughput'), 'Should mention throughput as decision driver');
      assert(drivers.includes('Message Size'), 'Should mention message size as decision driver');
    });

    it('should evaluate all three options', () => {
      const optionsSection = adrContent.match(/## Considered Options\s*\n([\s\S]*?)(?=\n## )/);
      assert(optionsSection, 'Missing considered options section');
      const options = optionsSection[1];
      
      // Should mention all three services
      assert(options.includes('SQS Standard'), 'Should evaluate SQS Standard');
      assert(options.includes('SQS FIFO'), 'Should evaluate SQS FIFO');
      assert(options.includes('Kinesis'), 'Should evaluate Kinesis');
      
      // Should have pros and cons for each
      assert(options.includes('Pros:'), 'Should list pros for options');
      assert(options.includes('Cons:'), 'Should list cons for options');
    });

    it('should provide clear decision with rationale', () => {
      const decisionSection = adrContent.match(/## Decision\s*\n([\s\S]*?)(?=\n## )/);
      assert(decisionSection, 'Missing decision section');
      const decision = decisionSection[1];
      
      // Should clearly state the chosen option
      assert(decision.includes('select'), 'Should clearly state selection');
      
      // Should mention rationale (case insensitive)
      assert(decision.toLowerCase().includes('rationale'), 'Should provide rationale');
      assert(decision.toLowerCase().includes('cost'), 'Should mention cost in rationale');
      assert(decision.toLowerCase().includes('throughput'), 'Should mention throughput in rationale');
    });

    it('should discuss consequences', () => {
      const consequencesSection = adrContent.match(/## Consequences\s*\n([\s\S]*?)(?=\n## )/);
      assert(consequencesSection, 'Missing consequences section');
      const consequences = consequencesSection[1];
      
      // Should discuss positive and negative consequences
      assert(consequences.includes('Positive'), 'Should discuss positive consequences');
      assert(consequences.includes('Negative'), 'Should discuss negative consequences');
      assert(consequences.includes('Neutral'), 'Should discuss neutral consequences');
    });

    it('should mention the throughput trap', () => {
      // The document should mention that FIFO appears cheaper but fails throughput
      assert(
        adrContent.includes('tempting') || adrContent.includes('appears cheaper'),
        'Should mention the tempting nature of FIFO'
      );
      assert(
        adrContent.includes('300') && adrContent.includes('400'),
        'Should contrast FIFO limit (300/s) with requirement (400/s)'
      );
    });
  });

  describe('Implementation guidance', () => {
    it('should provide implementation notes', () => {
      const implSection = adrContent.match(/## Implementation Notes\s*\n([\s\S]*?)(?=\n## )/);
      assert(implSection, 'Missing implementation notes section');
      const impl = implSection[1];
      
      // Should provide actionable guidance
      assert(impl.length > 100, 'Implementation notes should be substantive');
    });

    it('should verify compliance with requirements', () => {
      const complianceSection = adrContent.match(/## Compliance\s*\n([\s\S]*)/);
      assert(complianceSection, 'Missing compliance section');
      const compliance = complianceSection[1];
      
      // Should show checks against requirements
      assert(compliance.includes('✅'), 'Should use checkmarks for compliance');
      assert(compliance.includes('Budget'), 'Should verify budget compliance');
      assert(compliance.includes('Throughput'), 'Should verify throughput compliance');
    });
  });

  describe('Professional writing quality', () => {
    it('should be well-structured and readable', () => {
      // Check for proper headings hierarchy
      const headingLevels = adrContent.match(/^#+/gm);
      if (headingLevels) {
        // Should start with #, then ##, etc.
        assert(headingLevels[0] === '#', 'Should start with H1');
      }
      
      // Should have reasonable length
      const lineCount = adrContent.split('\n').length;
      assert(lineCount > 50, 'ADR should be substantive (> 50 lines)');
      assert(lineCount < 500, 'ADR should be concise (< 500 lines)');
    });

    it('should use technical terminology correctly', () => {
      // Should use correct service names
      assert(adrContent.includes('Amazon SQS'), 'Should use full service name');
      assert(adrContent.includes('Amazon Kinesis'), 'Should use full service name');
      
      // Should use correct technical terms
      assert(adrContent.includes('throughput'), 'Should use throughput correctly');
      assert(adrContent.includes('latency'), 'Should mention latency');
      assert(adrContent.includes('availability'), 'Should mention availability');
    });
  });
});