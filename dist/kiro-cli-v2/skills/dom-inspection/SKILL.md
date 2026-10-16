---
name: dom-inspection
version: 1.0.0
description: Extracts structured field-level metadata from web forms using the browser DOM and HTML5 Constraint Validation API. Produces a per-field inspection report capturing validation rules, error message selectors, and conditional visibility — used as input to functional test generation.
tags: [dom, forms, validation, testing, browser, html5, constraint-validation]
---

# DOM Inspection

## Overview

Extracts structured metadata from web forms by inspecting the live DOM. Produces a per-field inspection report that captures:

- **Declarative constraints** — HTML5 validation attributes (`required`, `pattern`, `min`, `max`, `minlength`, `maxlength`, `type`)
- **Error message selectors** — elements that render validation errors for each field (`aria-describedby`, `aria-errormessage`, `[role="alert"]`)
- **Conditional visibility** — fields that appear or disappear based on other field values
- **Cross-field business rules** — observable constraints between fields (e.g. date ranges, dependent dropdowns)

**This skill is distinct from accessibility auditing.** It focuses on extracting test oracles for functional test generation, not WCAG compliance. Accessibility concerns (contrast, focus order, screen reader compatibility) belong in a separate skill.

## Usage

Use this skill when:

- Generating functional tests that need accurate field-level assertions
- Discovering validation rules that are not visible from screenshots alone
- Building a discovery report that captures form business logic for test generation

Load this skill into `k-browser` (for live DOM inspection during app discovery) or `k-quality-assurance` (for interpreting an existing inspection report when generating specs).

## Inspection Protocol

### Phase 1: Static DOM Analysis

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

### Phase 2: Validation Trigger Analysis

For each form, determine when validation fires. **Try non-destructive methods first** — form submission can cause server-side side effects (creating records, sending emails, triggering workflows) on live apps. Note: a missing `action` attribute does NOT mean submission is safe — forms without `action` submit to the current URL, and SPAs ignore `action` entirely and use JS fetch/XHR handlers.

Detection order:

1. **Blur-triggered**: Tab through fields without filling them and observe error appearance → `validation_trigger: blur`
2. **Change-triggered**: Type then clear a field and observe → `validation_trigger: change`
3. **Submit-triggered**: Only attempt if the calling SOP has **explicitly confirmed** with the user that form submission is safe on this app. If not confirmed, set `validation_trigger: unknown` and skip. → `validation_trigger: submit`

**Default to `validation_trigger: unknown`** when blur/change detection is inconclusive and submission safety has not been confirmed. This is the safe choice for live apps.

Capture the exact error message text rendered for each field — this is the assertion string for test generation.

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

These cannot be extracted statically — they require interaction. Trigger each observable rule and record the constraint.

## Output Schema

Produce a `dom-inspection-report.json` with this structure:

```json
{
  "page_url": "<url>",
  "ui_framework": "cloudscape | material-ui | plain-html | unknown",
  "forms": [
    {
      "form_selector": "<selector>",
      "validation_trigger": "submit | blur | change | unknown",
      "fields": [
        {
          "selector": "<most reliable selector>",
          "label": "<exact visible label text>",
          "type": "text | email | number | date | select | checkbox | radio | textarea",
          "required": true,
          "pattern": "<regex string or null>",
          "min": "<value or null>",
          "max": "<value or null>",
          "minlength": "<number or null>",
          "maxlength": "<number or null>",
          "error_message_selector": "<selector for error element or null>",
          "error_message_text": "<exact error string rendered on violation or null>",
          "initially_hidden": false,
          "conditional_visibility": {
            "trigger_field_selector": "<selector or null>",
            "trigger_value": "<value that makes this field appear or null>"
          },
          "cross_field_rules": ["<human-readable description of observable constraint>"]
        }
      ]
    }
  ]
}
```

## Test Oracle Derivation

From the inspection report, derive these test cases for each field:

> **Safety note:** When `validation_trigger` is `unknown` (form submission safety could not be confirmed), test cases that involve submitting the form must be flagged as potentially unsafe and require explicit user confirmation before execution.

> **Trigger mapping:** "Trigger validation" in the table below means the action that matches the form's detected `validation_trigger`:
>
> - `submit` → submit the form
> - `blur` → tab out of the field without filling it
> - `change` → type then clear the field
> - `unknown` → flag as potentially unsafe; require explicit user confirmation before triggering

| Constraint                | Test case                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `required: true`          | Trigger validation with field empty → assert error message appears                                                       |
| `pattern`                 | Trigger validation with non-matching value → assert error; trigger with matching value → assert no error                 |
| `min` / `max`             | Trigger validation with value below min → assert error; above max → assert error; boundary values → assert pass          |
| `minlength` / `maxlength` | Trigger validation with string shorter than minlength → assert error; longer than maxlength → assert truncation or error |
| `type: email`             | Trigger validation with non-email string → assert error                                                                  |
| `conditional_visibility`  | Set trigger field to trigger value → assert conditional field appears; set to other value → assert field hidden          |
| `cross_field_rules`       | Violate the rule → assert error or blocked submission                                                                    |

## Cloudscape-Specific Notes

Cloudscape components wrap native HTML inputs — the validation attributes are on the inner `<input>` element, not the Cloudscape component wrapper. Always query the inner input:

```javascript
// Correct: query inner input inside Cloudscape wrapper
document.querySelectorAll('[class*="awsui"] input, [class*="awsui"] select, [class*="awsui"] textarea');
// Not: document.querySelectorAll('awsui-input')
```

Error messages in Cloudscape render in `[class*="error-text"]` or `[data-testid*="error"]` elements adjacent to the field wrapper, not via `aria-describedby` on the input itself.

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

- Capture `placeholder` text — useful as a fallback selector and documents expected input format
- Note fields with `autocomplete` attributes — relevant for test data strategy
