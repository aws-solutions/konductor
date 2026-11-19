const levels = { debug: 10, info: 20, warn: 30, error: 40 };

function methodFor(sink, name) {
  return name === 'debug' ? sink.log : sink[name];
}

export function makeLogger(level = 'info', sink = console) {
  const threshold = levels[level] ?? levels.info;
  return Object.fromEntries(Object.entries(levels).map(([name, value]) => [name, (...args) => {
    if (value >= threshold) methodFor(sink, name)(...args);
  }]));
}
