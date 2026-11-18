# Test oracles

Read this when deriving test cases from an existing `dom-inspection-report.json`.

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
