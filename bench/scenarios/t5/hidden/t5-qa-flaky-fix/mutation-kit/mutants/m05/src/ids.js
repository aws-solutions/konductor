function newId(prefix = 'job', random = Math.random) {
  const suffix = Math.floor(random() * 0x10000000).toString(36).padStart(7, '0');
  return `${prefix}_${Date.now().toString(36)}_${suffix}`;
}

module.exports = { newId };
