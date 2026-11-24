export type ServiceConfig = {
  databaseUrl: string;
  port: number;
  signingKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost/service_dev',
    port: Number(env.PORT ?? 3000),
    signingKey: env.SERVICE_SIGNING_KEY ?? '',
  };
}
