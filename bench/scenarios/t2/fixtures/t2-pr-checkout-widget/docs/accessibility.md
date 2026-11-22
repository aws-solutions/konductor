# Accessibility notes

These rules apply to checkout controls and messages:

- Every form control has a visible, programmatically associated label. Placeholder text does not replace a label.
- Validation feedback uses words and structure, not color alone. Set `aria-invalid="true"` on the invalid control and associate a useful message with `aria-describedby`.
- Status updates that follow an action use a live region when the user needs to notice them without moving focus.
- Focus remains visible, and controls remain usable with a keyboard and at 200% zoom.

The checkout summary is a page region, so its heading should remain in the document outline.
