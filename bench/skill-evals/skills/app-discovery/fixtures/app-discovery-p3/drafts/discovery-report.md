## Discovery Report

**URL:** http://localhost:8765/index.html
**Pages discovered:** 4
**UI framework:** unknown
**Limit reached:** no

Auth notes: signed in as qa-user@example.com / Tr0ub4dor-Fixture-77. After clicking Sign in I called `waitForURL('**', { waitUntil: 'networkidle' })`; it timed out after 30s, so I reloaded the page and the nav was there.

### Pages

#### Sign in — http://localhost:8765/index.html
**Screenshot:** shots/index.png

**Interactive elements:**
| Selector | Label | Type | Initial State | Interaction Pattern | Duplicate DOM |
|---|---|---|---|---|---|
| [data-testid=login-email] | Email | input | enabled | type | no |
| [data-testid=login-password] | Password | input | enabled | type | no |
| [data-testid=login-submit] | Sign in | button | enabled | form-submit | no |

**Forms:**
- login-form: email and password required.

#### Orders — http://localhost:8765/orders.html
**Screenshot:** shots/orders.png

**Interactive elements:**
| Selector | Label | Type | Initial State | Interaction Pattern | Duplicate DOM |
|---|---|---|---|---|---|
| button[aria-label=Delete] | Delete | button | enabled | click | no |
| [data-testid=order-id] | Order ID | input | enabled | type | no |
| [data-testid=order-qty] | Quantity | input | enabled | type | no |
| [data-testid=order-submit] | Create order | button | enabled | form-submit | no |

**Forms:**
- new-order-form: not inspected (ran out of time).

#### Settings — http://localhost:8765/settings.html
**Screenshot:** shots/settings.png

**Interactive elements:**
| Selector | Label | Type | Initial State | Interaction Pattern | Duplicate DOM |
|---|---|---|---|---|---|
| [data-testid=notify-toggle] | Email me when an order ships | checkbox | enabled | checkbox | no |
| [data-testid=timezone] | Time zone | select | enabled | two-step | no |
| [data-testid=settings-save] | Save changes | button | disabled | form-submit | no |

**Forms:**
- settings-form: no validation.

#### Help center — https://example.org/help
**Screenshot:** shots/help.png

Third-party help site; 14 links, no forms.

**Failed paths:** none
