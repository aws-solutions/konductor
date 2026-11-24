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
| t13-triage-issue-queue | author | gpt-5.6-luna | 4.88 |  |
| t13-triage-issue-queue | map | glm-5 | 0.22 |  |
| t13-triage-issue-queue | review | qwen3-coder-next | 0.83 |  |
| t13-triage-crash-reports | author | gpt-5.6-luna | 4.03 |  |
| t13-triage-crash-reports | map | glm-5 | 0.22 |  |
| t13-triage-crash-reports | review | glm-5 | 8.21 |  |
| t13-log-auth-credential-stuffing | author | gpt-5.6-luna | 3.45 |  |
| t13-log-auth-credential-stuffing | map | glm-5 | 0.22 |  |
| t13-log-auth-credential-stuffing | review | qwen3-coder-next | 1.82 |  |
| t13-log-batch-slowdown | author | gpt-5.6-luna | 4.76 |  |
| t13-log-batch-slowdown | map | glm-5 | 0.22 |  |
