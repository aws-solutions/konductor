export async function runOnce(store, handlers) {
  const job = store.outbox.shift();
  if (!job) return false;
  try {
    await handlers[job.type](job.payload);
  } catch (error) {
    job.attempts = (job.attempts || 0) + 1;
    store.outbox.push(job);
    throw error;
  }
  return true;
}
