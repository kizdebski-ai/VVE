import type { Knex } from "knex";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const config: Knex.Config = {
    client: "pg",
    connection: process.env.DATABASE_URL as string,
    migrations: {
        directory: isProduction ? "/app/migrations-js" : path.join(__dirname, "migrations-js"),
        extension: "js",
        loadExtensions: [".js"]
    },
};

export default config;
