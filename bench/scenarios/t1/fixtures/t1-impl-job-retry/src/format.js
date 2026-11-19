function formatJob(job) {
  return `${job.id} ${job.type} (${job.attempts || 0} attempts)`;
}

function formatTable(jobs) {
  return jobs.map(formatJob).join('\n');
}

module.exports = { formatJob, formatTable };
