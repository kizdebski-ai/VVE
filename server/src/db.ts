import knex, { Knex } from 'knex';
import { config } from './config';
import path from 'path';

let instance: Knex | null = null;

export const getDb = (): Knex => {
  if (!instance) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured.');
    }

    // Determine migrations directory based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    // In production (Docker): /app/migrations (copied by Dockerfile)
    // In dev: server/migrations (relative to project root)
    const migrationsDir = isProduction
      ? '/app/migrations'
      : path.join(__dirname, '..', '..', 'migrations');

    console.log('[DB] Migrations directory:', migrationsDir);

    instance = knex({
      client: 'pg',
      connection: config.databaseUrl,
      pool: { min: 0, max: 10 },
      migrations: {
        directory: migrationsDir,
        extension: 'js'
      }
    });
  }
  return instance;
};

export type DbConnection = Knex;
