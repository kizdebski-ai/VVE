"use strict";

exports.up = async function (knex) {
    // Add permanent access token for teachers (never expires, like student board tokens)
    await knex.schema.alterTable("teachers", (table) => {
        table.text("permanent_token_hash");
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("teachers", (table) => {
        table.dropColumn("permanent_token_hash");
    });
};
