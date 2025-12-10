import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    // Add permanent access token for teachers (never expires, like student board tokens)
    await knex.schema.alterTable("teachers", (table) => {
        table.text("permanent_token_hash");
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable("teachers", (table) => {
        table.dropColumn("permanent_token_hash");
    });
}
