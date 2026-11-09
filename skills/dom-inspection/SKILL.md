---
name: dom-inspection
version: 1.1.0
description: Extracts field-level metadata from web forms using the browser DOM and the HTML5 Constraint Validation API. Use when a functional test or discovery report needs a form's validation rules, error selectors or conditional fields from the live DOM. Produces a per-field inspection report.
tags: [dom, forms, validation, testing, browser, html5, constraint-validation]
---

# DOM Inspection

## Overview

Extracts structured metadata from web forms by inspecting the live DOM. Produces a per-field inspection report that captures:

- **Declarative constraints**: HTML5 validation attributes (`required`, `pattern`, `min`, `max`, `minlength`, `maxlength`, `type`)
- **Error message selectors**: elements that render validation errors for each field (`aria-describedby`, `aria-errormessage`, `[role="alert"]`)
- **Conditional visibility**: fields that appear or disappear based on other field values
- **Cross-field business rules**: observable constraints between fields (e.g. date ranges, dependent dropdowns)

**This skill is distinct from accessibility auditing.** It focuses on extracting test oracles for functional test generation, not WCAG compliance. Accessibility concerns (contrast, focus order, screen reader compatibility) belong in a separate skill.

## Usage

Use this skill when:

- Generating functional tests that need accurate field-level assertions
- Discovering validation rules that are not visible from screenshots alone
- Building a discovery report that captures form business logic for test generation

Load this skill into `k-browser` (for live DOM inspection during app discovery) or `k-quality-assurance` (for interpreting an existing inspection report when generating specs).

## Inspection Protocol

### Phase 1: Static DOM Analysis

If the page uses Cloudscape (`awsui` class names), open `references/cloudscape.md` (relative to this file) before running this script: the attributes sit on the inner `<input>`, so the field query below needs the Cloudscape form.

For each form on the page, extract HTML5 validation attributes without triggering any interaction:

```javascript
// Run in browser context via Playwright evaluate()
return Array.from(document.querySelectorAll('form')).map((form, index) => ({
  form_selector:
    form.getAttribute('data-testid') ||
    form.id ||
    (() => {
      const parts = [];
      let el = form;
      while (el && el !== document.body) {
        const parent = el.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        const idx = siblings.indexOf(el) + 1;
        parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${idx})`);
        if (el.id) {
          parts[0] = `#${CSS.escape(el.id)}`;
          break;
        }
        el = parent;
      }
      return parts.join(' > ');
    })(),
  fields: Array.from(form.querySelectorAll('input:not([type="hidden"]), select, textarea')).map((el) => ({
    selector: el.getAttribute('data-testid') || el.name || el.id,
    // Normalize type: el.type returns 'select-one'/'select-multiple' for <select>, use tagName instead
    type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type,
    label: (() => {
      if (el.labels?.length) return el.labels[0].textContent.trim();
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.textContent.trim();
      }
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const text = lb
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean)
          .join(' ');
        if (text) return text;
      }
      const w = el.closest('label');
      if (w) return w.textContent.trim();
      return null;
    })(),
    required: el.required,
    pattern: el.pattern || null,
    min: el.min || null,
    max: el.max || null,
    minlength: el.minLength > 0 ? el.minLength : null,
    maxlength: el.maxLength > 0 ? el.maxLength : null,
    ariaDescribedBy: el.getAttribute('aria-describedby'),
    ariaErrorMessage: el.getAttribute('aria-errormessage'),
    // checkVisibility() correctly handles display:none on ancestors and position:fixed containers
    // unlike !el.offsetParent which produces false positives for fixed-position modals
    initiallyHidden: !el.checkVisibility() || el.getAttribute('aria-hidden') === 'true',
  })),
}));
```

The script's keys are camelCase. When writing the report, use the snake_case schema in `references/report-and-test-oracles.md`: `initiallyHidden` becomes `initially_hidden`, and `ariaDescribedBy` or `ariaErrorMessage` resolves to the element you record as `error_message_selector`.

### Phase 2: Validation Trigger Analysis

For each form, determine when validation fires. **Try non-destructive methods first**: form submission can cause server-side side effects (creating records, sending emails, triggering workflows) on live apps. Note: a missing `action` attribute does NOT mean submission is safe. Forms without `action` submit to the current URL, and SPAs ignore `action` entirely and use JS fetch/XHR handlers.

Detection order:

1. **Blur-triggered**: Tab through fields without filling them and observe error appearance → `validation_trigger: blur`
2. **Change-triggered**: Type then clear a field and observe → `validation_trigger: change`
3. **Submit-triggered**: Only attempt if the calling SOP has **explicitly confirmed** with the user that form submission is safe on this app. If not confirmed, set `validation_trigger: unknown` and skip. → `validation_trigger: submit`

**Default to `validation_trigger: unknown`** when blur/change detection is inconclusive and submission safety has not been confirmed. This is the safe choice for live apps.

**Static or saved-file inspection.** When you only have the HTML source and no browser, you cannot observe blur or change, and reading a submit handler does not confirm that submitting is safe. Set `validation_trigger: unknown` unless the user has confirmed submission is safe, even when the source clearly validates on submit. Put what the source suggests and any side effects in `validation_trigger_note`, for example: `source validates in the submit handler, which POSTs to /api/orders and places an order; safety not confirmed`. Test generation reads `unknown` as "ask before submitting", which is what protects a live app.

Capture the exact error message text rendered for each field. It is the assertion string for test generation. On Cloudscape pages, find it with the error selectors in `references/cloudscape.md`, since it is not linked through `aria-describedby`.

### Phase 3: Conditional Visibility

For each field that is initially hidden (`initiallyHidden: true`):

1. Identify the trigger field (the field whose change causes this field to appear)
2. Record the trigger value that causes the field to appear
3. Record the selector of the conditional field

Pattern to detect: observe `MutationObserver` on the form container, then interact with each visible field to find which interaction causes hidden fields to appear.

### Phase 4: Cross-Field Business Rules

Observe and record:

- Date range fields where end must be after start
- Quantity/price fields with computed totals
- Dependent dropdowns (selecting value A in field 1 filters options in field 2)
- Fields that become required only when another field has a specific value

These cannot be extracted statically. They require interaction. Trigger each observable rule and record the constraint.

## Report and Test Oracles

Open `references/report-and-test-oracles.md` (relative to this file) when writing `dom-inspection-report.json` or deriving test cases from it. It holds the report JSON schema, the validation-trigger mapping, and the constraint-to-test-case table.

## Cloudscape

Open `references/cloudscape.md` (relative to this file) when the page uses Cloudscape (`awsui` class names). Validation attributes sit on the inner `<input>`, and error text is not linked through `aria-describedby`.

## Quality Gate

**CRITICAL (must capture):**

- `required` status for every field in every form
- `validation_trigger` for every form
- Error message selector for every field with `required: true` or a `pattern`

**IMPORTANT (capture when present):**

- `pattern`, `min`, `max`, `minlength`, `maxlength` attributes
- Conditional visibility triggers
- Cross-field business rules

**SUGGESTION:**

- Capture `placeholder` text, which is useful as a fallback selector and documents expected input format
- Note fields with `autocomplete` attributes, which matter for test data strategy
