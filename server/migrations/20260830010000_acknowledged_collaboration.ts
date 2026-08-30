import type { Knex } from 'knex';

/**
 * VVE-103: every mutation has a stable id and every snapshot records the
 * exact durable log cutoff it contains.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('board_yjs_state', (table) => {
    table.bigInteger('snapshot_cutoff').notNullable().defaultTo(0);
  });

  await knex.schema.alterTable('board_yjs_updates', (table) => {
    table.string('operation_id', 128);
  });

  await knex.raw(`
    UPDATE board_yjs_updates
    SET operation_id = 'legacy-' || id::text
    WHERE operation_id IS NULL
  `);

  await knex.schema.alterTable('board_yjs_updates', (table) => {
    table.string('operation_id', 128).notNullable().alter();
    table.unique(['board_id', 'operation_id'], {
      indexName: 'board_yjs_updates_board_operation_unique'
    });
    table.index(['board_id', 'id'], 'board_yjs_updates_board_sequence_index');
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('board_yjs_updates', (table) => {
    table.dropIndex(['board_id', 'id'], 'board_yjs_updates_board_sequence_index');
    table.dropUnique(['board_id', 'operation_id'], 'board_yjs_updates_board_operation_unique');
    table.dropColumn('operation_id');
  });
  await knex.schema.alterTable('board_yjs_state', (table) => {
    table.dropColumn('snapshot_cutoff');
  });
}
