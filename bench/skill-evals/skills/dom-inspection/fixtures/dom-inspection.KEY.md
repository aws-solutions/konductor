# dom-inspection fixture key
signup.html:
- Validation fires only inside the submit handler, and submit POSTs to /api/signup (creates account, sends email). Skill rule: submission safety unconfirmed -> validation_trigger "unknown", not "submit".
- companyName is inside #company-wrapper (display:none) -> initially_hidden true; trigger accountType = "business"; becomes required then.
- Cross-field: trialEnd must be after trialStart (error "Trial end must be after trial start.").
- Exact error strings live in MESSAGES in the script.
- Error selectors come from aria-describedby (#email-error etc).
profile-report.json: oracle derivation input. Boundaries: displayName 2/3/30/31 chars, age 12/13/120/121, website pattern match/mismatch, parentEmail conditional on age<16. Trigger is unknown -> any submit-based case must be flagged unsafe / needing confirmation.
cloudscape-settings.html: constraints are on inner <input class="awsui_input_...">; errors in [class*="error-text"] / data-testid *-error, not aria-describedby.
