'use strict';

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  throw new Error(`invalid boolean value: ${value}`);
}

function integerValue(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a whole number`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a non-negative whole number`);
  return number;
}

class Settings {
  constructor(raw, metadata = {}) {
    this.raw = Object.freeze({ ...raw });
    this.sources = Object.freeze({ ...(metadata.sources || {}) });
    this.serviceName = this.raw.SERVICE_NAME || 'service';
    this.port = integerValue('PORT', this.raw.PORT, 3000);
    this.logLevel = this.raw.LOG_LEVEL || 'info';
    this.debug = booleanValue(this.raw.DEBUG, false);
    this.timeoutMs = integerValue('TIMEOUT_MS', this.raw.TIMEOUT_MS, 5000);
    this.databaseUrl = this.raw.DATABASE_URL || '';
  }

  get(name, fallback) {
    return Object.prototype.hasOwnProperty.call(this.raw, name) ? this.raw[name] : fallback;
  }

  toJSON() {
    return { ...this.raw };
  }
}

module.exports = { Settings, booleanValue, integerValue };
