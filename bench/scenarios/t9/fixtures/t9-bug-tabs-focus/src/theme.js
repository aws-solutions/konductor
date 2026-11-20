function themeClass(theme) {
  const value = String(theme || 'mist').toLowerCase();
  return ['mist', 'dusk', 'paper'].includes(value) ? `theme-${value}` : 'theme-mist';
}

module.exports = { themeClass };
