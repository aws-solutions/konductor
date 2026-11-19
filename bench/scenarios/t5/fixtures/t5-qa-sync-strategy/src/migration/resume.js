async function resumeMigration({ source, target, checkpoints, runner }) {
  const saved = await checkpoints.read();
  const result = await runner({ source, target, checkpoints, startAfter: saved.lastId });
  return { ...result, resumedFrom: saved.lastId };
}

module.exports = { resumeMigration };
