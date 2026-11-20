'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const policy = require(path.join(root, 'ops/budget-policy.json'));

function normalizeMetricName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_(percent|pct|milliseconds|millisecond|ms)$/, '').replace(/^_|_$/g, '');
}

function parseSnapshot(csv) {
  const text = String(csv).trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(',').map((x) => x.trim());
  return lines.map((line) => {
    const values = line.split(',').map((x) => x.trim());
    const row = { minute: values[0] };
    headers.slice(1).forEach((header, index) => { row[normalizeMetricName(header)] = Number(values[index + 1]); });
    return row;
  }).filter((row) => !Number.isNaN(Date.parse(row.minute)));
}

function catalogue() {
  const file = fs.readFileSync(path.join(root, 'ops/metrics-catalogue.csv'), 'utf8');
  return new Set(file.split(/\r?\n/).slice(1).filter(Boolean).map((line) => normalizeMetricName(line.split(',')[0])));
}

function evaluate({ ring, snapshot, now }) {
  const settings = policy.rings[ring];
  if (!settings) return { decision: 'HOLD', reason: 'UNKNOWN_RING', metric: null, unit: null, value: null };
  const rows = Array.isArray(snapshot) ? snapshot : parseSnapshot(snapshot);
  const metric = normalizeMetricName(settings.metric);
  if (!catalogue().has(metric)) return { decision: 'HOLD', reason: 'UNKNOWN_METRIC', metric: settings.metric, unit: settings.unit, value: null };
  if (rows.length === 0) return { decision: 'HOLD', reason: 'NO_DATA', metric: settings.metric, unit: settings.unit, value: null };
  const ordered = [...rows].sort((a, b) => Date.parse(a.minute) - Date.parse(b.minute));
  const end = now ? Date.parse(now) : Date.parse(ordered[ordered.length - 1].minute);
  const start = end - settings.windowMinutes * 60000;
  const window = ordered.filter((row) => Date.parse(row.minute) >= start && Date.parse(row.minute) <= end);
  if (window.length < policy.minimumCompleteMinutes) return { decision: 'HOLD', reason: 'INSUFFICIENT_DATA', metric: settings.metric, unit: settings.unit, value: null };
  for (let i = 1; i < window.length; i += 1) {
    if (Date.parse(window[i].minute) - Date.parse(window[i - 1].minute) !== 60000) return { decision: 'HOLD', reason: 'DATA_GAP', metric: settings.metric, unit: settings.unit, value: null };
  }
  const values = window.map((row) => row[metric]);
  if (values.some((value) => !Number.isFinite(value))) return { decision: 'HOLD', reason: 'MISSING_METRIC', metric: settings.metric, unit: settings.unit, value: null };
  const value = Math.max(...values);
  if (value >= settings.rollbackAt) return { decision: 'ROLLBACK', reason: 'ROLLBACK_THRESHOLD', metric: settings.metric, unit: settings.unit, value };
  if (value < settings.promoteBelow) return { decision: 'PROMOTE', reason: 'WITHIN_BUDGET', metric: settings.metric, unit: settings.unit, value };
  return { decision: 'HOLD', reason: 'PROMOTION_THRESHOLD', metric: settings.metric, unit: settings.unit, value };
}

module.exports = { normalizeMetricName, parseSnapshot, evaluate };
