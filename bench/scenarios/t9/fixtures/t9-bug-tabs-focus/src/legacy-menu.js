function oldMenuLabel(key) {
  const names = { home: 'Home', work: 'Work', account: 'Account' };
  return names[key] || 'More';
}

module.exports = { oldMenuLabel };
