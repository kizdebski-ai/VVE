import knex, { Knex } from 'knex';
import { config } from './config';
import path from 'path';

let instance: Knex | null = null;

export interface CreateDbOptions {
  databaseUrl: string;
  quiet?: boolean;
}

const migrationsDirectory = (): string => {
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction ? '/app/migrations-js' : path.join(__dirname, '..', '..', 'migrations-js');
};

/** Construct a Knex pool owned by RuntimeControl. Does not start work on import. */
export const createDb = ({ databaseUrl, quiet = false }: CreateDbOptions): Knex => {
  const migrationsDir = migrationsDirectory();
  if (!quiet) {
    console.log('[DB] Migrations directory:', migrationsDir);
    console.log('[DB] NODE_ENV:', process.env.NODE_ENV);
  }
  return knex({
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 2, max: 20 },
    acquireConnectionTimeout: 10_000,
    migrations: {
      directory: migrationsDir,
      extension: 'js',
      loadExtensions: ['.js']
    }
  });
};

export const bindDb = (db: Knex): void => {
  instance = db;
};

export const getDb = (): Knex => {
  if (!instance) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured.');
    }
    instance = createDb({ databaseUrl: config.databaseUrl });
  }
  return instance;
};

export const destroyDb = async (): Promise<void> => {
  if (!instance) return;
  const current = instance;
  instance = null;
  await current.destroy();
};

export type DbConnection = Knex;
