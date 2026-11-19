function installShutdown(runner, signals = ['SIGINT', 'SIGTERM']) {
  const stop = () => runner.stop();
  for (const signal of signals) process.once(signal, stop);
  return () => signals.forEach(signal => process.removeListener(signal, stop));
}

module.exports = { installShutdown };
