# Claude Code stream fixtures

Real `claude -p --output-format stream-json --verbose` streams from Claude Code 2.1.316 on Bedrock, sanitized
(paths, user names, account ids and thinking signatures replaced). In every `system/init` event the `slash_commands`
list is emptied and `skills` is cut to six names to keep the files small; nothing else was changed.

| file | what it shows |
| --- | --- |
| vanilla-success | one Bash call, success, one model key |
| readonly-bash | read-only Bash allowed without approval |
| permission-denied | a denied Write: `system/permission_denied`, exit 0, `permission_denials[]` on the result |
| model-400 | invalid model id: `is_error` true, `terminal_reason` api_error, no cost |
| spawn-failed-then-retry | a sub-agent spawn failed (HTTP 400), the retry worked |
| opus-fallback | a retry ran on another model: a second `modelUsage` key with a different canonical model |
| delegation-single-model | one clean delegation, one model |
| delegation-dashed-pin | clean delegation with the dashed model pin: two result events (the sub-agent finished in the background and the session resumed), two `modelUsage` keys with the same canonical model, a SessionStart hook |
| sigterm | killed mid-tool: no `result` line |
| synthetic-credential-error | NOT captured. Built from `model-400` plus two `api_retry` events with `error: cloud_credential_error`, the shape the operator's re-check script looks for |
