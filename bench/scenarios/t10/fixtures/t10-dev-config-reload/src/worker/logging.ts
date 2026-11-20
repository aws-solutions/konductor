export function jobLog(jobId: string, queue: string, attempt: number, durationMs: number) {
  return { jobId, queue, attempt, durationMs };
}
