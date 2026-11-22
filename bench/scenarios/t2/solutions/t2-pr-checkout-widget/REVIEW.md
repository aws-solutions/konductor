Request changes before merging. The widget is easy to exercise on its happy path, but the current implementation violates the checkout contracts around accessible validation, locale-aware money, trusted rendering, and order submission. The new tests cover arithmetic and labels but do not exercise the browser event lifecycle or service responses.

The highest-risk issue is that both service messages reach innerHTML. A response that contains markup can execute in the checkout page. The order action also has no in-flight state, so two quick clicks can create two orders. Those should be fixed before release.

Findings:

- `src/checkout-summary.js:41` creates an input with only a placeholder and keeps the invalid state as a red input and hint while leaving the status empty. This gives the control no visible associated label and gives assistive technology no useful error relationship. Add a visible label, set aria-invalid, and provide an error message associated with aria-describedby.
- `src/checkout-summary.js:96` calls addEventListener from renderLines. The input handler calls renderLines on every keystroke, so the same list accumulates click handlers. Attach the event listener once, or use stable event delegation outside the render path.
- `src/checkout-summary.js:20` formats both line prices and the total with floating point toFixed values and a hard-coded dollar prefix. The page adapter converts integer cents to floats, while the checkout contract supports fr-FR and de-DE. Keep integer cents through the model and use formatMoney or Intl.NumberFormat with the active locale.
- `src/checkout-summary.js:123` and `src/checkout-summary.js:129` assign service messages to innerHTML. Treat promotion and order responses as untrusted text and render them with textContent, or sanitize them with a narrowly defined trusted-markup policy.
- `src/checkout-summary.js:129` starts submitOrder without disabling the button or tracking an in-flight request. Disable the button and add an in-flight guard until the request settles, including failure paths.
- `src/checkout-summary.js:66` labels the control Place order, but the UI copy contract requires the imperative label Submit order. Change the button label to Submit order.

```json
[
  {
    "location": "src/checkout-summary.js:41",
    "severity": "medium",
    "issue": "The promotion input has no associated visible label, and invalid input is communicated only by changing the color of the input and hint while the status remains empty, so keyboard and color-blind users do not get an accessible error or field relationship.",
    "fix": "Add a visible label, aria-invalid, and an error message associated with aria-describedby."
  },
  {
    "location": "src/checkout-summary.js:96",
    "severity": "medium",
    "issue": "Each promotion keystroke calls renderLines, which adds another click listener to the same list after replacing its children, causing handlers to accumulate during normal typing.",
    "fix": "Render once and attach one event listener using event delegation."
  },
  {
    "location": "src/checkout-summary.js:20",
    "severity": "medium",
    "issue": "The widget converts catalog cents to a floating point price and then builds currency strings with toFixed and a dollar prefix, so the documented locales cannot format separators and symbols correctly and floating point totals can leak into the UI.",
    "fix": "Keep integer cents and use formatMoney or Intl.NumberFormat with the active locale."
  },
  {
    "location": "src/checkout-summary.js:123",
    "severity": "critical",
    "issue": "Both service messages are assigned to innerHTML, allowing a promotion or order response containing markup from the server to execute script in the checkout page.",
    "fix": "Render service messages with textContent, or sanitize them before insertion."
  },
  {
    "location": "src/checkout-summary.js:129",
    "severity": "high",
    "issue": "The submit handler has no in-flight guard or disabled state, so two rapid clicks can send two order requests even though the checkout contract requires one request per user action.",
    "fix": "Disable the button and add an in-flight guard until the request settles."
  },
  {
    "location": "src/checkout-summary.js:66",
    "severity": "low",
    "issue": "The action is labeled Place order even though the checkout copy rule requires the imperative button label Submit order, making the new control inconsistent with the documented UI text.",
    "fix": "Change the button label to Submit order."
  }
]
```