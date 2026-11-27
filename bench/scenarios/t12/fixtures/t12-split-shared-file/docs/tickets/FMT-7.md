# FMT-7: accounting style for negative amounts

Finance prints credit notes with negative amounts in brackets. Add an options argument:
`formatMoney(cents, currency, { accounting: true })`. With `accounting: true`, a negative amount is shown as
`(€12.50)` instead of `-€12.50`; positive amounts and zero are unchanged. Without the option, nothing changes.

Done when: the option works for every currency, the old calls give the same text, a test covers it, and the
Unreleased section of CHANGELOG.md has a line that starts with `- FMT-7:`.
