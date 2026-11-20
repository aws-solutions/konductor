import { loadConfig } from '../config/loader.ts';

export async function executeJob(job: { payload: Record<string, unknown> }, run: (payload: Record<string, unknown>, timeoutMs: number) => Promise<unknown>) {
  const first = loadConfig();
  const timeoutMs = first.jobTimeoutMs;
  const second = loadConfig();
  const attempts = second.maxAttempts;
  const result = await run(job.payload, timeoutMs);
  return { result, attempts };
}
