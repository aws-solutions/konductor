import { loadConfig } from '../config/loader.ts';
import type { WorkerConfig } from '../config/types.ts';

type ConfigSource = { getSnapshot: () => WorkerConfig };

export async function executeJob(job: { payload: Record<string, unknown> }, run: (payload: Record<string, unknown>, timeoutMs: number, config?: WorkerConfig) => Promise<unknown>, source?: ConfigSource) {
  const config = source ? source.getSnapshot() : loadConfig();
  const result = await run(job.payload, config.jobTimeoutMs, config);
  return { result, attempts: config.maxAttempts };
}
