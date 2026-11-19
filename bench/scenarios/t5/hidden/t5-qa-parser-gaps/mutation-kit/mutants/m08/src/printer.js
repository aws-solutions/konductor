"use strict";

const { Quantity } = require("./values");

function needsQuotes(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return true;
  return false;
}

function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

function render(value) {
  if (typeof value === "string") return needsQuotes(value) ? quote(value) : value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value instanceof Quantity) return `${value.value}${value.unit}`;
  if (Array.isArray(value)) return `[${value.map(render).join(", ")}]`;
  throw new TypeError("cannot print this value");
}

function print(config) {
  const lines = [];
  const sections = [];
  const visit = (object, path) => {
    const keys = Object.keys(object).filter((key) => key !== "__locations").sort();
    const simple = keys.filter((key) => object[key] === null || typeof object[key] !== "object" || object[key] instanceof Quantity || Array.isArray(object[key]));
    if (path && keys.length === 0) sections.push({ path, lines: [] });
    for (const key of simple) lines.push(`${path ? `${path}.` : ""}${key} = ${render(object[key])}`);
    for (const key of keys) {
      const value = object[key];
      if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Quantity)) {
        const child = path ? `${path}.${key}` : key;
        const before = lines.length;
        visit(value, child);
        if (lines.length === before && !sections.some((section) => section.path === child)) sections.push({ path: child, lines: [] });
      }
    }
  };
  visit(config, "");
  const top = lines.filter((line) => !line.includes("."));
  const nested = lines.filter((line) => line.includes("."));
  if (top.length) lines.splice(0, lines.length, ...top);
  else lines.length = 0;
  if (nested.length) {
    const grouped = new Map();
    for (const line of nested) {
      const match = line.match(/^(.+)\.([^.=]+) = (.*)$/);
      if (!match) continue;
      const section = match[1];
      if (!grouped.has(section)) grouped.set(section, []);
      grouped.get(section).push(`${match[2]} = ${match[3]}`);
    }
    for (const [section, values] of grouped) {
      if (lines.length) lines.push("");
      lines.push(`[${section}]`, ...values);
    }
  }
  for (const section of sections) {
    if (lines.length) lines.push("");
    lines.push(`[${section.path}]`, ...section.lines);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

module.exports = { print, render, needsQuotes };
