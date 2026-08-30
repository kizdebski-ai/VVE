"use strict";

// JS mirror of migrations/20260830000000_board_lifecycle.ts for the Docker
// runtime (see src/db.ts). Keep both files in sync.

exports.up = async function (knex) {
    await knex.schema.alterTable("boards", (table) => {
        table.text("kind").notNullable().defaultTo("managed");
        table.text("student_label");
    });

    await knex.raw(
        "ALTER TABLE boards ADD CONSTRAINT boards_kind_check CHECK (kind IN ('personal', 'managed'))"
    );

    // A Personal Board never expires and is not addressable by public slug.
    await knex.raw("ALTER TABLE boards ALTER COLUMN valid_until DROP NOT NULL");

    // Exactly one Personal Board per Teacher (live boards only), enforced by
    // the database: concurrent lazy creation converges to a single row.
    await knex.raw(
        "CREATE UNIQUE INDEX boards_one_personal_per_teacher ON boards (teacher_id) " +
        "WHERE kind = 'personal' AND deleted_at IS NULL"
    );

    // The purge sweep selects boards whose Deletion Grace Period has elapsed.
    await knex.raw(
        "CREATE INDEX boards_delete_after_due ON boards (delete_after) " +
        "WHERE delete_after IS NOT NULL AND deleted_at IS NULL"
    );

    await knex.schema.alterTable("boards", (table) => {
        table.dropColumn("archived_at");
        table.dropColumn("student_token_hash");
        table.dropColumn("student_id");
    });

    // The students table carried per-board student identity rows; the Pilot's
    // Student Label is stored on the board and is internal only.
    await knex.schema.dropTableIfExists("students");
};

exports.down = async function (knex) {
    await knex.schema.createTable("students", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("organization_id").references("id").inTable("organizations");
        table.uuid("teacher_id").references("id").inTable("teachers");
        table.text("full_name");
        table.text("external_id");
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.index("teacher_id");
    });

    await knex.schema.alterTable("boards", (table) => {
        table.uuid("student_id").references("id").inTable("students");
        table.text("student_token_hash");
        table.timestamp("archived_at", { useTz: true });
        table.dropColumn("student_label");
        table.dropColumn("kind");
    });

    await knex.raw("ALTER TABLE boards ALTER COLUMN valid_until SET NOT NULL");
    await knex.raw("DROP INDEX IF EXISTS boards_delete_after_due");
    await knex.raw("DROP INDEX IF EXISTS boards_one_personal_per_teacher");
    await knex.raw("ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_kind_check");
};
