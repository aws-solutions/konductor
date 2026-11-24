# T13 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported; the owner's spend rule counts every call at 15 or its real cost, whichever is larger, against the step's cap of 300 counted (the counted ledger lives in the authoring dir, not here). Calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) through `run.sh` in an isolated HOME (the sign-in only), on an empty working directory outside every checkout. Owner approval 2026-11-24: GO T13 AUTHOR, cap 300 counted.

## Calls

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t13-doc-api-reference-drift | author | gpt-5.6-luna | 5.33 |  |
| t13-doc-api-reference-drift | map | glm-5 | 0.22 |  |
| t13-doc-api-reference-drift | review | qwen3-coder-next | 0.86 |  |
| t13-doc-agents-onboarding | author | gpt-5.6-luna | 10.58 |  |
| t13-doc-agents-onboarding | map | glm-5 | 0.22 |  |
| t13-doc-agents-onboarding | review | glm-5 | 4.39 |  |
