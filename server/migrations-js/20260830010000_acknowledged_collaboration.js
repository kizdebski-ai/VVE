/** VVE-103 durable acknowledgement schema. */
async function up(knex) {
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

async function down(knex) {
  await knex.schema.alterTable('board_yjs_updates', (table) => {
    table.dropIndex(['board_id', 'id'], 'board_yjs_updates_board_sequence_index');
    table.dropUnique(['board_id', 'operation_id'], 'board_yjs_updates_board_operation_unique');
    table.dropColumn('operation_id');
  });
  await knex.schema.alterTable('board_yjs_state', (table) => {
    table.dropColumn('snapshot_cutoff');
  });
}

module.exports = { up, down };
