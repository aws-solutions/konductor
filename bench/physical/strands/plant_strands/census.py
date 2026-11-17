# SPDX-License-Identifier: Apache-2.0
"""Lists everything in a Strands agent that can change a tool call on its way to or from a plant tool (SR-22).

Hooks are registered per event, not per tool, so any callback on a tool event reaches the plant tools too. The census
reads the agent's hook and middleware registries, which are private in strands-agents; it was written against
1.65.0, and a registry it cannot read is reported as `unreadable`, which the runner treats as a forbidden entry.
"""
import inspect

# What a callback on each tool event may write, from the event classes' `_can_write` (strands-agents 1.65.0), plus
# the interrupt that BeforeToolsEvent and BeforeToolCallEvent can raise.
TOOL_EVENT_WRITES = {
    "BeforeToolsEvent": ["cancel", "interrupt"],
    "BeforeToolCallEvent": ["cancel_tool", "selected_tool", "tool_use", "interrupt"],
    "AfterToolCallEvent": ["result", "retry"],
    "AfterToolsEvent": ["end_turn"],
}
SDK_MODULE = "strands."


def _name_of(fn):
    """`module.qualname` of a callable; for Strands' wrapper around an Input or Output middleware, the wrapped one's."""
    inner = inspect.getclosurevars(fn).nonlocals.get("handler") if getattr(fn, "__qualname__", "").endswith("adapted") else None
    target = inner or fn
    return "%s.%s" % (getattr(target, "__module__", None), getattr(target, "__qualname__", type(target).__name__))


def _hooks(agent):
    entries = []
    for event_type, callbacks in agent.hooks._registered_callbacks.items():
        if event_type.__name__ in TOOL_EVENT_WRITES:
            for entry in callbacks:
                name = _name_of(entry.callback)
                entries.append({"event": event_type.__name__, "callback": name, "sdk": name.startswith(SDK_MODULE), "mayWrite": TOOL_EVENT_WRITES[event_type.__name__]})
    return entries


def _middleware(agent):
    entries = []
    for stage, handlers in agent._middleware_registry._handlers.items():
        stage_name = getattr(stage, "name", None) or type(stage).__name__
        for tagged in handlers:
            name = _name_of(tagged.handler)
            entries.append({"stage": str(stage_name), "phase": tagged.phase, "handler": name, "sdk": name.startswith(SDK_MODULE)})
    return entries


def census(agent, plant_tools):
    """The census of `agent`, whose plant tools must be the ForwardingTool objects in `plant_tools` (name to tool).

    Returns `{hooks, middleware, tools, executor, unreadable}`: every callback on a tool event, every middleware
    handler, for each plant tool whether the agent's registry holds that exact stub ("forwarder", else "replaced" or
    "missing"), the tool executor's class, and the registries that could not be read.
    """
    found = {"hooks": [], "middleware": [], "unreadable": []}
    for key, read in (("hooks", _hooks), ("middleware", _middleware)):
        try:
            found[key] = read(agent)
        except (AttributeError, TypeError) as e:
            found["unreadable"].append("%s: %s" % (key, e))
    registry = agent.tool_registry.registry
    tools = {name: "forwarder" if registry.get(name) is tool else ("replaced" if name in registry else "missing") for name, tool in plant_tools.items()}
    executor = type(agent.tool_executor)
    return {**found, "tools": tools, "executor": "%s.%s" % (executor.__module__, executor.__qualname__)}
