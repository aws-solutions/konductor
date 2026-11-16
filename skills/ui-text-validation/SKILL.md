---
name: ui-text-validation
description: Validates UI text against public AWS style guidance, Cloudscape design standards, and general content quality principles. Use when reviewing user-facing text in console-style applications. Produces findings organized by severity with before/after examples.
version: 1.0.0
tags:
  [
    skill,
    ui-text,
    aws-style-guide,
    cloudscape,
    quality-assurance,
    accessibility,
  ]
---

# UI Text Validation

## Overview

Reviews UI text for voice and tone compliance, capitalization, content structure, terminology, help panel content, accessibility, and localization readiness. Findings are organized by severity (critical, warning, suggestion) with specific before/after examples.

## Usage

Use this skill when:

- Reviewing UI text before a console feature ships
- Checking compliance with Cloudscape writing guidelines and general AWS style conventions
- Validating accessibility and localization readiness of UI content

## Core Concepts

### Evaluation Categories

Voice and tone, capitalization (sentence case everywhere, including headings), content structure, terminology (service names, inclusive language), help panel content, field-specific guidelines (titles as noun phrases, descriptions explain purpose, hints show constraints), accessibility, and localization readiness (30% expansion allowance).

## Report Output

Report findings inline in your response by default. Write a report file only for a multi-page audit or when the user asks for one. In that case:

1. Ask for the file path (for example `ui-reviews/s3-bucket-wizard-audit.md`)
2. Create the file with the progress tracker at the top
3. Mark each section complete in the tracker and update "Last Updated" as you finish it
4. Save after each major section so work is not lost
5. Mark the evaluation complete when finished

The file becomes a working document the team uses to assign, track, and verify fixes.

## Evaluation Framework

### Sources of Truth (In Priority Order)

1. **Cloudscape Help Panel Pattern**: https://cloudscape.design/patterns/general/help-system/ and
   https://cloudscape.design/components/help-panel/
2. **Cloudscape Alert Component**: https://cloudscape.design/components/alert/
3. **Cloudscape Accessibility Guidance**: https://cloudscape.design/foundation/core-principles/accessibility/

> This checklist's internal counterpart also cites a dedicated AWS Style Guide (voice, consoles-and-UI,
> global-English, legal-guidelines, safe-names) and an internal AWS content-strategy standards page. No public
> equivalent exists for those references — the corresponding guidance below is retained as general principles
> without a source link, and each gap is called out explicitly rather than papered over with an unrelated link.

## Evaluation Checklist

### 1. Voice and Tone (CRITICAL)

**Must have:**

- Active voice (not passive): "You can select" not "Can be selected"
- Second person "you/your" to address customers
- First person "we" when referring to the product or service
- Present tense for current state and behavior
- Direct and friendly tone (conversational yet professional)
- Plain, everyday language (avoid jargon)

**Never use:**

- "Please", "thank you", or "sorry"
- Exclamation points
- Ellipsis (...)
- Ampersand (&) except in brand names
- "e.g.", "i.e.", "etc."
- "Just" or "simply"
- Future tense contractions (I'll, you'll)
- Passive voice constructions

**Tone Traits to Verify:**

1. Approachable (personable, not chatty)
2. Authoritative (professional, not stuffy)
3. Concise (succinct, not wordy)
4. Conversational (informal, not stilted)
5. Directed (focused, not vague)
6. Respectful (considerate, not condescending)
7. Simple (plain, not fancy)
8. Smart (knowledgeable, not pedantic)
9. Trustworthy (reliable, not evasive)

### 2. Capitalization and Punctuation

**Required:**

- Sentence case for all headers, buttons, labels (not title case)
- Capitalize proper nouns and service names correctly
- End punctuation in body text and descriptions
- No end punctuation on headers, buttons, or labels

**Avoid:**

- Title Case Headers
- Punctuation on buttons or headers
- Inconsistent capitalization

### 3. Content Structure and Clarity

**Best practices:**

- Keep text short and scannable (remember 30% expansion for localization)
- Use simple sentences (one subject, one verb, one main clause)
- Parallel construction in lists (all verbs or all nouns)
- Device-independent language: "choose" or "select" not "click"
- Avoid directional language: "previous" not "above", "following" not "below"
- Focus on customer goals and tasks
- Provide context before asking for action

**Page/Section Descriptions:**

- Page description: 2 sentences maximum, thoroughly summarizes content
- Section description: 1 sentence, accurately describes section purpose

### 4. Terminology and Naming

**Verify:**

- Consistent terminology within the application and with its public documentation
- Correct capitalization of service and product names — no public equivalent exists for this checklist's
  internal source-of-truth reference (an internal service-name registry); verify against the product's own
  published documentation instead
- Third-party names match official branding
- New feature names use lowercase (not Title Case)
- Acronyms follow standard technical-writing guidance (spell out on first use unless in exception list)
- Inclusive terminology

**Never include:**

- Internal code names or project names
- Employee email addresses or names
- Offensive or sensitive terms

### 5. Help Panel Content

**Required:**

- At least one Info link next to each console page title
- Help panel provides additional helpful content (doesn't just repeat UI text)
- 1-3 "Learn more" links to relevant documentation topics
- Clear, concise explanations that complement the UI
- Follows help panel guidance: https://cloudscape.design/patterns/general/help-system/ and
  https://cloudscape.design/components/help-panel/

### 6. UI Component-Specific Guidelines

**Alerts (Error, Warning, Info, Success):**

- Clear, actionable message
- Explains what happened and why
- Provides next steps or resolution
- Uses appropriate severity level
- Follows alert pattern: https://cloudscape.design/components/alert/

**Buttons:**

- 1-3 words starting with verb or verb phrase
- Sentence case
- No end punctuation
- Clear action indication

**Links:**

- Descriptive link text (not "click here")
- Appropriate use of in-console vs external links
- Help panel Info links present where needed

**Form Fields:**

- Clear labels in sentence case
- Helpful placeholder text or constraints
- Validation messages that are specific and actionable

### 7. Accessibility

**Ensure:**

- Text follows accessible language requirements
- Content usable by customers with disabilities
- Sufficient context for screen readers
- Clear error messages with specific guidance
- Follows accessibility guidance: https://cloudscape.design/foundation/core-principles/accessibility/

### 8. Localization Readiness

**Verify:**

- Concise wording (allows 30% expansion)
- Global English (appropriate for worldwide audience)
- No culturally-specific idioms or expressions
- No public equivalent exists for this checklist's internal global-English source-of-truth reference; apply
  general plain-language and internationalization best practices instead

### 9. Legal and Compliance

**Check:**

- No internal company information exposed
- Fictitious names use legally approved examples only
- No public equivalent exists for this checklist's internal legal-guidelines and safe/fictitious-names
  source-of-truth references; consult your organization's own legal and brand guidance instead

### 10. Technical Accuracy

**Validate:**

- Text accurately describes functionality
- Instructions are correct and complete
- Terminology matches actual behavior
- No misleading or ambiguous statements

## Output Format

Use this structure for a report file. For an inline report, keep the Executive Summary, the three issue sections, and Strengths, and drop the tracking parts.

```markdown
# UI Text Evaluation Report

**Application/Component:** [Name]
**Evaluation Date:** [Date]
**Evaluator:** [Your name or "AI Assistant"]
**Report Location:** [File path]

---

## Progress Tracker

- [x] Evaluation started
- [ ] Voice and tone review complete
- [ ] Capitalization and punctuation review complete
- [ ] Content structure and clarity review complete
- [ ] Terminology and naming review complete
- [ ] Help panel content review complete
- [ ] UI component-specific review complete
- [ ] Accessibility review complete
- [ ] Localization readiness review complete
- [ ] Legal and compliance review complete
- [ ] Technical accuracy review complete
- [ ] Executive summary written
- [ ] Definition of done checklist completed
- [x] Evaluation complete

**Last Updated:** [Timestamp]

---

## Executive Summary

**Overall Quality:** [Excellent / Good / Needs Improvement / Poor]

**Issue Count:**

- Critical: [X]
- Warning: [X]
- Suggestion: [X]

**Key Themes:**

- [Theme 1]
- [Theme 2]
- [Theme 3]

**Recommendation:** [Ready to launch / Needs minor fixes / Requires significant revision / Not ready]

---

## CRITICAL ISSUES (Must Fix Before Launch)

Issues that violate core standards or create customer confusion.

### [Component/Location]

- **Issue:** [Specific problem with example]
- **Guideline Violated:** [Reference to specific guideline]
- **Fix:** [Specific recommendation with corrected text]
- **Impact:** [Why this matters to customers]
- **Status:** [ ] Not Started | [ ] In Progress | [ ] Fixed | [ ] Verified

---

## WARNINGS (Should Fix)

Issues that violate best practices or reduce quality.

### [Component/Location]

- **Issue:** [Specific problem with example]
- **Guideline Violated:** [Reference to specific guideline]
- **Fix:** [Specific recommendation with corrected text]
- **Impact:** [Why this matters to customers]
- **Status:** [ ] Not Started | [ ] In Progress | [ ] Fixed | [ ] Verified

---

## SUGGESTIONS (Consider Improving)

Opportunities to enhance clarity, consistency, or customer experience.

### [Component/Location]

- **Current:** [What's there now]
- **Suggestion:** [How to improve it]
- **Benefit:** [Why this would help customers]
- **Status:** [ ] Not Started | [ ] In Progress | [ ] Implemented | [ ] Verified

---

## STRENGTHS

Highlight what the UI text does well:

- [Strength 1]
- [Strength 2]
- [Strength 3]

---

## DEFINITION OF DONE CHECKLIST

Verify the UI meets minimum quality bar:

- [ ] UI text conforms to voice and tone guidance
- [ ] All text reviewed by writer/editor and revisions incorporated
- [ ] Content building correctly with no missing content
- [ ] Links to help content functional (not hardcoded)
- [ ] Each page includes help panel Info link
- [ ] Sentence case used throughout
- [ ] No prohibited terms (please, e.g., i.e., etc.)
- [ ] Active voice and present tense used
- [ ] Inclusive terminology verified
- [ ] Accessibility requirements met
- [ ] Localization readiness confirmed
- [ ] Legal requirements satisfied
- [ ] Technical accuracy validated

**Overall Status:** [X/13] items complete

---

## REFERENCES

Guidelines referenced in this evaluation:

- [Guideline 1 with link]
- [Guideline 2 with link]
- [Guideline 3 with link]

---

## IMPLEMENTATION TRACKING

### Critical Issues

| ID  | Component   | Issue               | Assigned To | Status | Verified |
| --- | ----------- | ------------------- | ----------- | ------ | -------- |
| C1  | [Component] | [Brief description] | [Name]      | [ ]    | [ ]      |
| C2  | [Component] | [Brief description] | [Name]      | [ ]    | [ ]      |

### Warnings

| ID  | Component   | Issue               | Assigned To | Status | Verified |
| --- | ----------- | ------------------- | ----------- | ------ | -------- |
| W1  | [Component] | [Brief description] | [Name]      | [ ]    | [ ]      |
| W2  | [Component] | [Brief description] | [Name]      | [ ]    | [ ]      |

### Suggestions

| ID  | Component   | Suggestion          | Assigned To | Status | Verified |
| --- | ----------- | ------------------- | ----------- | ------ | -------- |
| S1  | [Component] | [Brief description] | [Name]      | [ ]    | [ ]      |
| S2  | [Component] | [Brief description] | [Name]      | [ ]    | [ ]      |

---

**Next Steps:**

1. [Action item 1]
2. [Action item 2]
3. [Action item 3]

**Follow-up Date:** [Date for re-evaluation]
```

## Evaluation Approach

1. **Review systematically** - Go through each UI component type
2. **Check against guidelines** - Use the evaluation checklist
3. **Provide specific examples** - Include before/after text
4. **Prioritize issues** - Organize by customer impact
5. **Reference official sources** - Link to design-system guidelines for each recommendation
6. **Be constructive** - Highlight strengths as well as issues
7. **Focus on customer experience** - How does this help customers complete tasks?
8. **For a report file** - Follow Report Output and add the implementation tracking tables
9. **Review and clean up** - Remove any false positives or evaluation errors before finalizing

**CRITICAL: Quality Control Before Finalizing**

- Review all flagged issues to confirm they are actual violations
- Remove any issues marked "already correct" or identified as false positives
- Renumber remaining issues sequentially (C1, C2, C3... not C1, C4, C5)
- Update issue counts in executive summary to match final list
- Ensure all cross-references use correct issue numbers

## Modal Verbs Guidance

Use precise modal verbs:

- **must** - for obligations and requirements
- **can** - for capabilities and permissions
- **we recommend** or **consider** - for suggestions
- **might** or **may** - for possibilities
- Avoid **should** (ambiguous between recommendation and requirement)

## Common Patterns to Check

**Before → after:**

- **Passive:** "The instance can be stopped by clicking the button" → **Active:** "To stop the instance, choose Stop"
- **Title Case:** "Create New Resource" → **Sentence case:** "Create new resource"
- **Jargon:** "Instantiate a new compute resource" → **Plain language:** "Create a new instance"
- **Wordy:** "In order to be able to proceed with the configuration..." → **Concise:** "To configure..."
- **Directional:** "Click the button below" → **Device-independent:** "Choose Create"

## Deliverable

A UI text audit, inline or as a file, that:

- **Identifies all issues** - With specific locations and examples
- **Prioritizes by severity** - Critical → Warning → Suggestions with customer impact
- **Provides actionable fixes** - Corrected text for each issue
- **References official guidelines** - Design-system links for each recommendation
- **Highlights strengths** - Positive patterns to reinforce

A report file also includes the progress tracker, the definition of done checklist with completion status, implementation tracking tables (status, assignment, and verification columns), and a follow-up date.

## Example Usage

A user asks: "Evaluate the UI text for our new S3 bucket creation wizard." Review the wizard section by section and report the findings inline.

If the user asks for a report file ("Save it to docs/ui-audits/s3-wizard.md"), create it at that path, fill it section by section with the progress tracker updated as you go, and mark it complete when finished. The team then assigns issues, checks off status boxes as fixes land, and reuses the file for follow-up evaluations.

## Quality Gate

**CRITICAL (must fix):**

- Error messages expose internal system details (stack traces, internal IDs)
- Action labels are ambiguous (e.g., "Submit" instead of "Create bucket")
- Required field labels missing from form inputs

**WARNING (should fix):**

- Capitalization not in sentence case (labels, buttons, and headings)
- Jargon or acronyms used without explanation in customer-facing text
- Help panel content missing for complex configuration options

**SUGGESTION:**

- Could add localization notes for text that may not translate directly
- Could strengthen empty state messages with actionable next steps

Present findings as: CRITICAL → WARNING → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
