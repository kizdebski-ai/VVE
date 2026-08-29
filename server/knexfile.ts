import type { Knex } from "knex";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const config: Knex.Config = {
    client: "pg",
    connection: process.env.DATABASE_URL as string,
    migrations: {
        directory: isProduction ? "./migrations" : "./migrations",
        extension: isProduction ? "js" : "ts",
    },
};

export default config;
