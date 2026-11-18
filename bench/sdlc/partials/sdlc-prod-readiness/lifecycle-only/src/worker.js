'use strict';

const API_KEY = 'sk_live_51HxQe7Lm2Vt9RkP0aZ';

const defaultLog = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

/**
 * The invoice worker. `queue` has take() and push(); `handler(job, { apiKey })` sends one invoice; `env` holds the
 * settings of docs/READINESS.md; `log(entry)` receives one structured entry per finished job; `clock.now()` stamps
 * successes.
 */
function createWorker({ queue, handler, env = process.env, log = defaultLog, clock = Date }) {
  const config = { apiKey: API_KEY, concurrency: Number(env.WORKER_CONCURRENCY || 2), drainMs: Number(env.WORKER_DRAIN_MS || 5000) };
  const metrics = { processed: 0, failed: 0, inFlight: 0 };
  let state = 'idle';
  let lastSuccessAt = null;
  let onIdle = null;
  let signalStop;
  const stopSignal = new Promise((resolve) => { signalStop = resolve; });

  async function runJob(job) {
    metrics.inFlight++;
    try {
      await handler(job, { apiKey: config.apiKey });
      metrics.processed++;
      lastSuccessAt = clock.now();
      log({ level: 'info', msg: 'job done', jobId: job.id });
    } catch (err) {
      metrics.failed++;
      log({ level: 'error', msg: 'job failed', jobId: job.id, error: err && err.message ? err.message : String(err) });
    } finally {
      metrics.inFlight--;
      if (!metrics.inFlight && onIdle) onIdle();
    }
  }

  // The next job, or null once stop is called. A take still waiting at stop puts its job back when one arrives.
  function nextJob() {
    const take = queue.take();
    return Promise.race([take, stopSignal.then(() => null)]).then((job) => {
      if (job === null) take.then((late) => { if (late) queue.push(late); });
      return job;
    });
  }

  async function loop() {
    while (state === 'running') {
      const job = await nextJob();
      if (!job) return;
      await runJob(job);
    }
  }

  function start() {
    state = 'running';
    for (let i = 0; i < config.concurrency; i++) loop();
  }

  function stop() {
    state = 'stopping';
    signalStop();
    if (!metrics.inFlight) return Promise.resolve({ drained: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { onIdle = null; resolve({ drained: false }); }, config.drainMs);
      onIdle = () => { clearTimeout(timer); resolve({ drained: true }); };
    });
  }

  return {
    start,
    stop,
    health: () => ({ ok: state === 'running', inFlight: metrics.inFlight, lastSuccessAt }),
    getMetrics: () => ({ ...metrics }),
  };
}

module.exports = { createWorker };
