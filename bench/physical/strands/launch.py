# SPDX-License-Identifier: Apache-2.0
"""Runs one Strands agent against the plant gateway with forwarding tool stubs, writing the trace to stdout.

    python -I launch.py --model fake:<script.json> [--agent-file FILE] PROMPT
    python -I launch.py --census [--agent-file FILE] --tools get_state,set_speed,...

The run file `$HOME/.plant/strands.json` holds `{"socket": <gw.sock path>}`; the runner writes it, as it writes the
Kiro CLI agent file for the shim. `--agent-file` names a Python file whose `build_agent(model, tools)` returns a
Strands Agent built on exactly that model and those tools; without it a plain Agent is built. `--census` builds the
agent with stub tools that cannot reach a gateway, prints its census and exits, so the runner can refuse hooks before
any trial starts.

Only the `fake:` model provider is accepted, so this launcher can make no paid model call. Exit codes: 0 the agent
finished; 1 the agent raised; 2 a bad argument or a refused model provider; 3 the gateway was not reachable or
refused tools/list (the runner reads it as a plant startup failure, like Kiro CLI's exit 3).
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
EXIT_AGENT, EXIT_USAGE, EXIT_STARTUP = 1, 2, 3


class Refused(Exception):
    """A launch problem with its exit code and the trace stage that names it."""

    def __init__(self, code, stage, message):
        super().__init__(message)
        self.code = code
        self.stage = stage


def model_of(spec):
    """The model for `spec`: `fake:<path>` is a ScriptedModel. Any other provider is refused (no paid calls here)."""
    provider, _, rest = spec.partition(":")
    if provider != "fake" or not rest:
        raise Refused(EXIT_USAGE, "model", "model %r refused: only fake:<script.json> is enabled; a real provider needs the owner's go-ahead" % spec)
    from plant_strands.fake_model import ScriptedModel
    return ScriptedModel.from_file(rest)


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
    trace.write("start", v=TRACE_VERSION, adapter=ADAPTER, strands=_version(strands), sessionId=uuid.uuid4().hex, model=args.model)
    model = model_of(args.model)
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
        raise Refused(EXIT_AGENT, "agent", "%s: %s" % (type(e).__name__, e))
    for tool_use_id, status, content in tool_results(agent.messages):
        trace.write("tool_result", toolUseId=tool_use_id, status=status, content=content)
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
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model")
    parser.add_argument("--agent-file")
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
