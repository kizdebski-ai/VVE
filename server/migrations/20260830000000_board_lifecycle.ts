import type { Knex } from "knex";

/**
 * VVE-102 (slice S2): BoardLifecycle durable state.
 *
 *  - `boards.kind`: 'managed' (one Owning Teacher, one Board Access Link,
 *    twelve-month validity) or 'personal' (one per Teacher, created lazily on
 *    the first dashboard visit, NEVER student-accessible — no slug, no
 *    token). A partial unique index enforces the single Personal Board at
 *    the database level, which also makes concurrent lazy creation safe.
 *  - `boards.student_label`: the CONTEXT.md Student Label — a minimal
 *    Teacher-facing label for one Student or a student group. Internal only;
 *    it replaces the per-board `students` row model.
 *  - `boards.valid_until` becomes nullable: a Personal Board never expires.
 *    Managed Boards keep NOT NULL in practice because BoardLifecycle is the
 *    only writer and fixes it to created + 12 months.
 *  - `boards.delete_after` gets a partial index for the purge sweep.
 *  - REMOVED (replace-don't-layer, fresh-database Pilot):
 *      * `boards.archived_at` — the experimental archive/restore proxy for
 *        "access ended" is replaced by explicit `access_ended_at` +
 *        `delete_after` semantics (ADR-0006); no recovery control exists.
 *      * `boards.student_token_hash` — superseded by the retrievable random
 *        `student_token` (VVE-101).
 *      * `boards.student_id` + the `students` table — the Student Label is a
 *        label, not an identity (CONTEXT.md).
 */
export async function up(knex: Knex): Promise<void> {
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
}

export async function down(knex: Knex): Promise<void> {
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
}
