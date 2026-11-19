function progress(done, total) {
  if (!total) return 100;
  return Math.round((done / total) * 100);
}

module.exports = { progress };
