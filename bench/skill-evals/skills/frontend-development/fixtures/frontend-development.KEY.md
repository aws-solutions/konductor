# frontend-development fixture key (judge only)

No node_modules; nothing compiles offline. Checks are static.

src/CreateProjectForm.tsx planted: useState-managed form fields and errors, manual validation, hardcoded messages instead of VALIDATION_MESSAGES in src/constants.ts, `any` (props and region state), native <div style={{...}}>, <span>, <button>. Expected: useForm<CreateProjectValues>({ resolver: zodResolver(schema) }), Controller/useFormContext, messages from VALIDATION_MESSAGES, Cloudscape Box/SpaceBetween/Button/Form, no inline style.

src/BookingForm.tsx: already RHF + zod. Expected cross-field rule via .refine (or superRefine) with path ['endDate'] and VALIDATION_MESSAGES.endBeforeStart; not .transform.

src/DetailsPanel.tsx planted: label/value native divs, dynamic `columns={fields.length}`. Expected KeyValuePairs with a fixed column count.
