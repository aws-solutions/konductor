# SPDX-License-Identifier: Apache-2.0
"""A small closed JSON Schema checker for tool arguments and control frames. Never coerces a value."""
import re


class SchemaError(ValueError):
    """`path` names the failing value; the message says why."""

    def __init__(self, path, message):
        super().__init__(f"{path or '$'}: {message}")
        self.path = path


TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "null": lambda v: v is None,
}


def check(value, schema, path=""):
    """Raises SchemaError unless `value` matches `schema`.

    Supported keywords: type (a name or a list of names), const, enum, minimum, maximum, maxLength,
    pattern, required, properties, additionalProperties (false, or a schema for every extra value).
    A float is never an integer, and a bool is never an integer.
    """
    _check_type(value, schema, path)
    _check_scalar(value, schema, path)
    if isinstance(value, dict):
        _check_object(value, schema, path)


def _check_type(value, schema, path):
    wanted = schema.get("type")
    if wanted is None:
        return
    names = wanted if isinstance(wanted, list) else [wanted]
    if not any(TYPE_CHECKS[name](value) for name in names):
        raise SchemaError(path, f"expected {'/'.join(names)}")


def _check_scalar(value, schema, path):
    if "const" in schema and value != schema["const"]:
        raise SchemaError(path, f"must be {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise SchemaError(path, f"must be one of {schema['enum']}")
    if "minimum" in schema and value < schema["minimum"]:
        raise SchemaError(path, f"below {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        raise SchemaError(path, f"above {schema['maximum']}")
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        raise SchemaError(path, f"longer than {schema['maxLength']}")
    if "pattern" in schema and not re.fullmatch(schema["pattern"], value):
        raise SchemaError(path, "does not match the pattern")


def _check_object(value, schema, path):
    for name in schema.get("required", []):
        if name not in value:
            raise SchemaError(path, f"missing {name}")
    props = schema.get("properties", {})
    extra = schema.get("additionalProperties", True)
    for name, item in value.items():
        if name in props:
            check(item, props[name], f"{path}.{name}")
        elif extra is False:
            raise SchemaError(path, f"unknown field {name}")
        elif isinstance(extra, dict):
            check(item, extra, f"{path}.{name}")
