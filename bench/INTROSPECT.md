# Introspection runs

`bench.js run --introspect` records, for each run, what the agent was sent and what it did, request by request. It is a diagnostic mode: the runs are marked with the flag `introspect`, and `run-config.json` records `introspect.comparable: false`. Without the flag nothing in `runner/lib/introspect/` runs.

## What is captured

| probe | Claude Code | kiro-cli (engine v3) |
| --- | --- | --- |
| P1 exact model input | OpenTelemetry `api_request_body` events (`OTEL_LOG_RAW_API_BODIES`), the full JSON request body | the engine's request dump (`KIRO_DUMP_REQUESTS`), the full `conversationState` per model call |
| P2 timing and tokens per request | `api_request` events: start, latency, time to first token, input, output, cache read and write tokens, cost | `KIRO_TIMELINE` markers in the engine log: start and latency per model call. No tokens per request; credits stay per turn in the stream |
| P3 tool calls | the stream (as `trace` reads it) plus `tool_result` and `tool_decision` events with durations; session transcripts, sub-agent ones included, copied from the scratch HOME | the stream plus `tool_start` and `tool_end` markers; session files as before |
| P4 hooks | `hook_started` and `hook_response` stream events and the `hook_execution_*` OTEL events (duration, stdout and additional-context sizes) | `hooks.*` engine log lines and any `HOOK_INSTRUCTION` block in a request |
| P5 preloaded context | read from the first request body: prompt blocks and their sections, injected files, system reminders, the skills listing, skill bodies, tool definitions | the same, from the first dump of the conversation |

## Where it goes

Everything stays on the host, in `<run>/introspect` (mode 0700, files 0600), inside the out dir, so the harness scrub covers it:

- `probe.json`: the probe settings, what the sink received, the collector watch, what was copied.
- `otlp.jsonl` (Claude Code): every OTLP request body the run sent.
- `claude-projects/` (Claude Code), `kiro/`, `tmp-logs/`, `home-logs/` (kiro-cli): copies of the agent-written probe files. Links and special files are skipped, never followed.
- `timeline.md` and `timeline.json`: the report. Its first-request section lists the tool names the prompt mentions (backticked snake_case words and `tool::<server>::<name>` ids) and whether each one is in the tool list sent with the request.

kiro-cli writes its request and configuration dumps to `<run root>-introspect`, a sibling of the run root, so they are outside the agent's working directory and HOME. The isolation keeps that directory writable for the engine; the runner copies it to `kiro/` after the agent exits and removes it with the run root.

`node bench/scripts/introspect-summary.js <out-dir>` writes `<out-dir>/introspect-summary.md` and `.json`: one row per run and the mean per arm and task. `--rebuild` regenerates every run's report from its files first.

## No host collector

The agent environment is an allowlist, so no `OTEL_*` or telemetry variable of the invoking shell reaches it; `probe.json` lists the names it saw in the parent (`parentTelemetryNames`). For Claude Code the runner starts a loopback OTLP/HTTP receiver per run (127.0.0.1, a port the OS picks) and points every exporter endpoint at it; the run is refused if any endpoint in the merged environment points elsewhere, or if a telemetry variable is present that the probe did not set. The installed `settings.json` `env` block is checked for telemetry names too (`settingsTelemetryNames`).

While the agent runs, the collector watch samples `ss -Htnp` every 250 ms for sockets to 127.0.0.1:20774 (the host collector) and the OTLP defaults 4317 and 4318, and attributes a socket to the run when its process has the run's HOME or a cwd under the run root. `collectorWatch.clean` is true when no sample saw one. A connection that opens and closes between two samples would not be seen; the sink's request counts are the positive evidence that the exporters used the run's endpoint.
