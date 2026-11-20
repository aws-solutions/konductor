const prefix = 'northstar:';

function storageKey(name) {
  return `${prefix}${name}`;
}

function readSetting(storage, name, fallback = null) {
  const value = storage.getItem(storageKey(name));
  return value === null ? fallback : value;
}

module.exports = { storageKey, readSetting };
