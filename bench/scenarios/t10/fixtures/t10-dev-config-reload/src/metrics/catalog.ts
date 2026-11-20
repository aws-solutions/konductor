export const metricNames = ['worker_jobs_total', 'worker_failures_total', 'worker_queue_age_seconds', 'worker_active_jobs'];
export function metric(name: string, value: number) { return { name, value }; }
