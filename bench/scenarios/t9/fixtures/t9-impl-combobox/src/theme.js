function setTheme(root, theme) { root.dataset.theme = theme === 'night' ? 'night' : 'day'; } if (typeof module !== 'undefined') module.exports = { setTheme };
