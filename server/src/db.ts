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
    const migrationsDir = isProduction
      ? path.join(__dirname, '..', 'migrations')  // dist/migrations in production
      : path.join(__dirname, '..', '..', 'migrations');  // server/migrations in dev

    instance = knex({
      client: 'pg',
      connection: config.databaseUrl,
      pool: { min: 0, max: 10 },
      migrations: {
        directory: migrationsDir,
        extension: 'js'  // Always use .js - TypeScript compiles to .js
      }
    });
  }
  return instance;
};

export type DbConnection = Knex;
