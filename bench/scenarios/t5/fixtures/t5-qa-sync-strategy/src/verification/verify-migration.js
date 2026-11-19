async function verifyMigration(source, target) {
  const sourceCount = await source.count();
  const targetCount = await target.count();
  return { ok: sourceCount === targetCount, sourceCount, targetCount };
}

module.exports = { verifyMigration };
