"use strict";

exports.up = async function (knex) {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS "citext"');

    // 1. organizations
    await knex.schema.createTable("organizations", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.text("name").notNullable();
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // 2. teachers
    await knex.schema.createTable("teachers", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("organization_id").references("id").inTable("organizations");
        table.specificType("email", "citext").unique().notNullable();
        table.text("full_name");
        table.boolean("is_active").notNullable().defaultTo(true);
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp("last_login_at", { useTz: true });
        table.index("organization_id");
    });

    // 3. teacher_magic_links
    await knex.schema.createTable("teacher_magic_links", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("teacher_id").notNullable().references("id").inTable("teachers").onDelete("CASCADE");
        table.text("token_hash").notNullable();
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp("expires_at", { useTz: true }).notNullable();
        table.timestamp("used_at", { useTz: true });
        table.text("user_agent");
        table.specificType("ip_addr", "inet");
        table.index("teacher_id");
        table.index("expires_at");
    });

    // 4. students
    await knex.schema.createTable("students", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("organization_id").references("id").inTable("organizations");
        table.uuid("teacher_id").references("id").inTable("teachers");
        table.text("full_name");
        table.text("external_id");
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.index("teacher_id");
    });

    // 5. boards
    await knex.schema.createTable("boards", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("organization_id").references("id").inTable("organizations");
        table.uuid("teacher_id").notNullable().references("id").inTable("teachers");
        table.uuid("student_id").references("id").inTable("students");
        table.text("title");
        table.text("public_slug").unique();
        table.text("student_token_hash").notNullable();
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp("valid_until", { useTz: true }).notNullable();
        table.timestamp("archived_at", { useTz: true });
        table.timestamp("deleted_at", { useTz: true });
        table.index("teacher_id");
        table.index("valid_until");
    });

    // 6. board_yjs_state
    await knex.schema.createTable("board_yjs_state", (table) => {
        table.uuid("board_id").primary().references("id").inTable("boards").onDelete("CASCADE");
        table.binary("ydoc_state").notNullable();
        table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // 7. board_yjs_updates
    await knex.schema.createTable("board_yjs_updates", (table) => {
        table.bigIncrements("id").primary();
        table.uuid("board_id").notNullable().references("id").inTable("boards").onDelete("CASCADE");
        table.binary("update").notNullable();
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.index(["board_id", "created_at"]);
    });

    // 8. board_access_logs
    await knex.schema.createTable("board_access_logs", (table) => {
        table.bigIncrements("id").primary();
        table.uuid("board_id").references("id").inTable("boards");
        table.text("actor_type").notNullable();
        table.uuid("actor_id");
        table.timestamp("at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.specificType("ip_addr", "inet");
        table.text("user_agent");
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("board_access_logs");
    await knex.schema.dropTableIfExists("board_yjs_updates");
    await knex.schema.dropTableIfExists("board_yjs_state");
    await knex.schema.dropTableIfExists("boards");
    await knex.schema.dropTableIfExists("students");
    await knex.schema.dropTableIfExists("teacher_magic_links");
    await knex.schema.dropTableIfExists("teachers");
    await knex.schema.dropTableIfExists("organizations");
};
