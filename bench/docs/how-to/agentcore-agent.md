# Quick start: benchmark an agent on Amazon Bedrock AgentCore

[← bench home](../../README.md) · detailed guides: [Write a plugin](../write-a-plugin.md) ·
[Benchmark an agent](../agents.md#plug-in-a-new-agent-type)

**bench cannot benchmark a deployed AgentCore agent today.** It has no AgentCore harness, arm, flag or launcher.
Two parts of bench assume the agent runs on this host. Code tasks give the agent a local project folder in a
sandbox, then check the files it leaves. The plant gateway is a local socket that a remote agent cannot reach.

Two paths exist. Neither measures the deployment itself.

## Path 1: your AgentCore agent is a Strands agent

This measures your agent's code, run locally on the plant.

1. Put the code that builds your agent in `AGENT.py`, as `build_agent(model, tools)` returning a Strands `Agent`.
2. Follow [Quick start: benchmark a Strands agent](strands-agent.md), steps 1 to 6.

## Path 2: any other agent, as a new plugin

This passes bench's free plugin checks. It is not yet a fair benchmark: the remote agent cannot work on the task
folder, and the sandbox does not cover it.

1. Make one local command that calls your deployed runtime and prints one JSON event per line.

2. Copy the plugin template. Set `name` in `plugin.json` and `id` in `meta.js` to `agentcore`, and pick a new arm
   prefix and stream format.

   ```bash
   cp -r bench/kit/plugin-template bench/plugins/agentcore
   ```

3. Rewrite `harness.js` for your command. Record one real run as `test/fixtures/single-turn.jsonl`.

4. Write the golden file, then run the four free checks until each prints `PASS`.

   ```bash
   node bench/kit/plugin/check.js --record bench/plugins/agentcore
   node bench/kit/plugin/check.js bench/plugins/agentcore
   ```

5. See your plugin in the plugins table (a new plugin's arms do not show in `list-arms` yet).

   ```bash
   node bench/runner/bench.js plugins
   ```

## Missing today

- A harness that calls a deployed AgentCore runtime.
- A way for a remote agent to work on the task's project folder, so code checks and hidden tests can score it.
- Sandbox and stream checks for an agent that bench does not start itself.
- A route from a remote agent to the plant gateway.

These are tracked in [DEBT.md](../../DEBT.md) (row D-259).

## Go deeper

- [Write a plugin](../write-a-plugin.md): the plugin kit, its four checks and a worked example.
- [Harness contract](../../runner/lib/harness/CONTRACT.md): every member a harness must have.
- [Benchmark an agent: plug in a new agent type](../agents.md#plug-in-a-new-agent-type).
