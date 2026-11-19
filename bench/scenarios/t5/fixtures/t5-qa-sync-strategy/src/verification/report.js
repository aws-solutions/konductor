function formatVerification(result) {
  const status = result.ok ? 'PASS' : 'FAIL';
  return `${status}: source=${result.sourceCount} target=${result.targetCount}`;
}
module.exports = { formatVerification };
