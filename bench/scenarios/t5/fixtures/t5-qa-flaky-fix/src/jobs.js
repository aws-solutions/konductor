const { newId } = require('./ids');

function createJob(input, random) {
  if (!input || typeof input.title !== 'string' || input.title.trim() === '') throw new TypeError('title is required');
  if (!input.rule || typeof input.rule.weekday !== 'string') throw new TypeError('rule is required');
  return {
    id: input.id || newId('job', random),
    title: input.title.trim(),
    rule: { ...input.rule },
    enabled: input.enabled !== false
  };
}

function disableJob(job) {
  return { ...job, enabled: false };
}

module.exports = { createJob, disableJob };
