# frontend-review fixture key
SettingsForm.tsx: L5 props: any; L6-8 form state in useState (no RHF/Zod); L11-13 manual validation + hardcoded message; L10 handler not memoized; L19 native <div> + inline style; L27 native <button>.
AddressForm.tsx: L9-10 hardcoded validation messages (use constants); L17 useForm() without <AddressFormValues>; L19 handleCancel not memoized (useCallback); L31 ColumnLayout columns={extras.length} dynamic.
AddressFields.tsx: compliant (useFormContext, Cloudscape); `as string` assertions are minor.
AddressForm.test.tsx: L9 existence-only assertion; onSave never asserted; no error-state test; vi used without import.

# v2 additions
- Real functional bug (not in the skill checklist): AddressForm schema requires `city` (z.string().min(1), L11) but AddressFields renders no city input, so the form can never pass validation and onSave never fires. A strong reviewer catches this; the test at L8-9 would not.
- `extras` prop is only used for the column count and never rendered.
- City rule has no message at all (L11), separate from the hardcoded messages on L9-10.
- AddressFields.tsx is compliant apart from minor `as string` casts; inventing native-HTML or inline-style findings there is a false positive.
