export type WorkerConfig = {
  pollIntervalMs: number;
  maxAttempts: number;
  leaseSeconds: number;
  logLevel: string;
  queueName: string;
  region: string;
  workerConcurrency: number;
  maxPayloadBytes: number;
  jobTimeoutMs: number;
  backoffMs: number;
};

export type JobConfigView = Pick<WorkerConfig, 'maxAttempts' | 'jobTimeoutMs' | 'backoffMs'>;
