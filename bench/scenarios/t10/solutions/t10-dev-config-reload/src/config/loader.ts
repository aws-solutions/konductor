import { loadConfig as loadReloadedConfig } from './reload.ts';
import type { WorkerConfig } from './types.ts';

export function loadConfig(rootDir = '.', env: Record<string, string | undefined> = process.env): WorkerConfig {
  return loadReloadedConfig({ rootDir, env });
}
