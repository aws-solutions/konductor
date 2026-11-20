export function focusFirstInvalid(form) {
  const invalid = form.querySelector(':invalid');
  if (invalid) invalid.focus();
}
