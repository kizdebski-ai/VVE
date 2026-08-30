/** Preserve operation-id deduplication after replay-log compaction. */
async function up(knex) {
  await knex.schema.createTable('board_yjs_operation_receipts', (table) => {
    table.uuid('board_id').notNullable().references('id').inTable('boards').onDelete('CASCADE');
    table.string('operation_id', 128).notNullable();
    table.text('update_digest').notNullable();
    table.bigInteger('sequence').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['board_id', 'operation_id']);
    table.index(['board_id', 'sequence'], 'board_yjs_receipts_board_sequence_index');
  });
}

async function down(knex) {
  await knex.schema.dropTableIfExists('board_yjs_operation_receipts');
}

module.exports = { up, down };
