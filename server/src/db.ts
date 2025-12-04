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
      pool: { min: 0, max: 10 }
    });
  }
  return instance;
};

export type DbConnection = Knex;
