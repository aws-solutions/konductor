function health({ source, target }) { return { source: Boolean(source), target: Boolean(target), ok: Boolean(source && target) }; }
module.exports = { health };
