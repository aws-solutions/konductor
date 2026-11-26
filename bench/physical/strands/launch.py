# SPDX-License-Identifier: Apache-2.0
"""Runs one Strands agent against the plant gateway with forwarding tool stubs, writing the trace to stdout.

    python -I launch.py --model fake:<script.json> [--agent-file FILE] PROMPT
    python -I launch.py --model bedrock:<pinned model id> --max-usd X [--agent-file FILE] PROMPT
    python -I launch.py --census [--agent-file FILE] --tools get_state,set_speed,...

The run file `$HOME/.plant/strands.json` holds `{"socket": <gw.sock path>}`; the runner writes it, as it writes the
Kiro CLI agent file for the shim. `--agent-file` names a Python file whose `build_agent(model, tools)` returns a
Strands Agent built on exactly that model and those tools; without it a plain Agent is built. `--census` builds the
agent with stub tools that cannot reach a gateway, prints its census and exits, so the runner can refuse hooks before
any trial starts.

`fake:` is the scripted model, which makes no model call. `bedrock:` takes only a model id pinned in
plant_strands/bedrock_models.json, in that file's region, and needs `--max-usd`: the hard spend cap of this trial
(plant_strands/spend_cap.py). Credentials come from the AWS_* variables the runner passes. Exit codes: 0 the agent
finished; 1 the agent raised; 2 a bad argument or a refused model; 3 the gateway was not reachable or refused tools/list
(the runner reads it as a plant startup failure, like Kiro CLI's exit 3); 4 the spend cap stopped the agent.
"""
import argparse
import importlib.util
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plant_strands.trace import Trace, TRACE_VERSION  # noqa: E402

ADAPTER = {"kind": "B", "name": "plant-strands-forwarder", "version": 1}
RUN_FILE = os.path.join(".plant", "strands.json")
EXIT_AGENT, EXIT_USAGE, EXIT_STARTUP, EXIT_SPEND_CAP = 1, 2, 3, 4


class Refused(Exception):
    """A launch problem with its exit code and the trace stage that names it."""

    def __init__(self, code, stage, message):
        super().__init__(message)
        self.code = code
        self.stage = stage


def model_of(spec, max_usd, trace):
    """`(model, capped)` for `spec`. `fake:<path>` is a ScriptedModel and `capped` is None. `bedrock:<id>` is a
    BedrockModel for a pinned id, wrapped in a CappedModel of `max_usd`, which is also returned as `capped`."""
    provider, _, rest = spec.partition(":")
    if provider == "fake" and rest:
        from plant_strands.fake_model import ScriptedModel
        return ScriptedModel.from_file(rest), None
    if provider != "bedrock" or not rest:
        raise Refused(EXIT_USAGE, "model", "model %r refused: use fake:<script.json> or bedrock:<pinned model id>" % spec)
    from plant_strands.spend_cap import CappedModel, load_pins
    pins = load_pins()
    pin = pins["models"].get(rest)
    if pin is None:
        raise Refused(EXIT_USAGE, "model", "model %r refused: not pinned in bedrock_models.json (pinned: %s)" % (spec, ", ".join(sorted(pins["models"]))))
    if max_usd is None or not max_usd > 0:
        raise Refused(EXIT_USAGE, "model", "a bedrock model needs --max-usd, a positive spend cap")
    from strands.models.bedrock import BedrockModel
    capped = CappedModel(BedrockModel(model_id=rest, boto_session=bedrock_session(pins["region"]), max_tokens=pin["maxTokens"]), pin, max_usd, trace)
    return capped, capped


def bedrock_session(region):
    """A boto3 session for Bedrock: the profile named by AWS_PROFILE (or the default chain when unset), in `region`.

    Passed to BedrockModel as boto_session. An explicit session stops Strands from building its own default one,
    which did not pick up the profile in the probe runs (NoCredentialsError)."""
    import boto3
    return boto3.Session(profile_name=os.environ.get("AWS_PROFILE") or None, region_name=region)


def build_agent(model, tools, agent_file):
    """The agent from `agent_file`'s `build_agent(model, tools)`, or a plain Agent when `agent_file` is None."""
    if agent_file is None:
        from strands import Agent
        return Agent(model=model, tools=tools, callback_handler=None)
    spec = importlib.util.spec_from_file_location("plant_agent", agent_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_agent(model, tools)


def tool_results(messages):
    """`(toolUseId, status, content)` of every tool result in the agent's conversation, in order."""
    for message in messages:
        for block in message.get("content", []):
            if "toolResult" in block:
                r = block["toolResult"]
                yield r.get("toolUseId"), r.get("status"), r.get("content")


def run(args, trace):
    """Runs the agent once on `args.prompt` and writes its trace lines."""
    import strands
    from strands.models.model import Model  # noqa: F401 (fails here, before the gateway, if strands is broken)
    from plant_strands.client import GatewayClient
    from plant_strands.forward import forwarding_tools
    from plant_strands.recording_model import RecordingModel
    from plant_strands.census import census
    from plant_strands.spend_cap import spend_cap_of
    trace.write("start", v=TRACE_VERSION, adapter=ADAPTER, strands=_version(strands), sessionId=uuid.uuid4().hex, model=args.model)
    model, capped = model_of(args.model, args.max_usd, trace)
    with open(os.path.join(os.environ["HOME"], RUN_FILE), encoding="utf-8") as f:
        socket_path = json.load(f)["socket"]
    client = GatewayClient(socket_path)
    try:
        specs = client.tools_list()
    except Exception as e:  # any failure to list tools means the plant path never came up
        raise Refused(EXIT_STARTUP, "gateway", "plant gateway unreachable: %s" % e)
    tools = forwarding_tools(specs, client, trace)
    agent = build_agent(RecordingModel(model, trace), list(tools.values()), args.agent_file)
    trace.write("census", **census(agent, tools))
    try:
        result = agent(args.prompt)
    except Exception as e:
        cap = spend_cap_of(e)
        if cap is not None:
            raise Refused(EXIT_SPEND_CAP, "spend_cap", str(cap))
        raise Refused(EXIT_AGENT, "agent", "%s: %s" % (type(e).__name__, e))
    finally:
        # A capped run writes its spend even when the agent raised, so the runner always sees what was paid for.
        if capped is not None:
            trace.write("usage", **capped.usage())
    for tool_use_id, status, content in tool_results(agent.messages):
        trace.write("tool_result", toolUseId=tool_use_id, status=status, content=content)
    if capped is None:
        metrics = getattr(result, "metrics", None)
        usage = getattr(metrics, "accumulated_usage", None) or {}
        trace.write("usage", inputTokens=usage.get("inputTokens", 0), outputTokens=usage.get("outputTokens", 0),
                    modelCalls=getattr(metrics, "cycle_count", 0))
    trace.write("final", status="success", stopReason=str(result.stop_reason), text=str(result))
    client.close()


def run_census(args, trace):
    """Builds the agent on stub tools named `args.tools` and writes only its census."""
    from plant_strands.census import census
    from plant_strands.fake_model import ScriptedModel
    from plant_strands.forward import forwarding_tools
    from plant_strands.recording_model import RecordingModel
    specs = [{"name": name, "inputSchema": {"type": "object"}} for name in args.tools.split(",") if name]
    tools = forwarding_tools(specs, None, trace)
    agent = build_agent(RecordingModel(ScriptedModel([]), trace), list(tools.values()), args.agent_file)
    trace.write("census", **census(agent, tools))


def _version(module):
    try:
        from importlib.metadata import version
        return version("strands-agents")
    except Exception:
        return getattr(module, "__version__", None)


def main(argv=None):
    """Runs the launcher with `argv` (default sys.argv): `--census` lists the hooks, else one prompt runs. Returns the exit code."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model")
    parser.add_argument("--agent-file")
    parser.add_argument("--max-usd", type=float)
    parser.add_argument("--census", action="store_true")
    parser.add_argument("--tools", default="")
    parser.add_argument("prompt", nargs="?")
    args = parser.parse_args(argv)
    trace = Trace()
    try:
        if args.census:
            run_census(args, trace)
        elif not args.model or args.prompt is None:
            raise Refused(EXIT_USAGE, "usage", "--model and a prompt are required")
        else:
            run(args, trace)
    except Refused as e:
        trace.write("error", stage=e.stage, message=str(e))
        return e.code
    except Exception as e:
        trace.write("error", stage="launch", message="%s: %s" % (type(e).__name__, e))
        return EXIT_AGENT
    return 0


if __name__ == "__main__":
    sys.exit(main())
