async function processBatch(application, jobs, instant) {
  for (const job of jobs) application.service.add(job);
  return application.service.runDue(instant);
}

module.exports = { processBatch };
