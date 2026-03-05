import knex, { Knex } from 'knex';
import { config } from './config';

let instance: Knex | null = null;

export const getDb = (): Knex => {
  if (!instance) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured.');
    }
    instance = knex({
      client: 'pg',
      connection: config.databaseUrl,
      // 5.6: Increase pool limits; 5.9: add acquire timeout to avoid hanging queries
      pool: { min: 2, max: 20 },
      acquireConnectionTimeout: 10_000
    });
  }
  return instance;
};

export type DbConnection = Knex;
