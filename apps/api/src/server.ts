import path from 'node:path';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Db, createEmbeddedDb, createPostgresDb } from './db/client';
import { migrate } from './db/migrations';

async function main(): Promise<void> {
  const config = loadConfig();
  const db: Db = config.DATABASE_URL
    ? createPostgresDb(config.DATABASE_URL)
    : await createEmbeddedDb(path.resolve(__dirname, '..', '.pgdata'));

  const ran = await migrate(db);
  const app = await buildApp({ db, logLevel: config.LOG_LEVEL, rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE });
  if (ran.length > 0) app.log.info({ migrations: ran }, 'applied migrations');
  if (!config.DATABASE_URL) app.log.warn('DATABASE_URL is not set: using the embedded development database in .pgdata');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
