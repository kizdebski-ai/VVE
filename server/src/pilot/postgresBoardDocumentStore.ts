import type { Knex } from 'knex';
import { createHash } from 'crypto';
import * as Y from 'yjs';

import { getDb } from '../db';
import {
  CollaborationFailure,
  type AppendResult,
  type BoardDocumentStore,
  type HydratedBoardState
} from './collaborationRuntime';

type SnapshotRow = {
  ydoc_state: Buffer;
  snapshot_cutoff: string | number;
};

type UpdateRow = {
  id: string | number;
  operation_id: string;
  update: Buffer;
};

type ReceiptRow = {
  operation_id: string;
  update_digest: string;
  sequence: string | number;
};

const sequence = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Unsafe collaboration sequence: ${String(value)}`);
  }
  return parsed;
};

const updateDigest = (update: Uint8Array): string =>
  createHash('sha256').update(update).digest('hex');

export interface CreatePostgresBoardDocumentStoreOptions {
  db?: Knex;
}

/** PostgreSQL Adapter for the BoardDocument durable log. */
export const createPostgresBoardDocumentStore = (
  options: CreatePostgresBoardDocumentStoreOptions = {}
): BoardDocumentStore => {
  const db = () => options.db ?? getDb();

  return {
    hydrate: async (boardId): Promise<HydratedBoardState> =>
      db().transaction(async (trx) => {
        await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const state = (await trx('board_yjs_state')
          .where({ board_id: boardId })
          .first('ydoc_state', 'snapshot_cutoff')) as SnapshotRow | undefined;

        const snapshot = state?.ydoc_state
          ? new Uint8Array(state.ydoc_state)
          : Y.encodeStateAsUpdate(new Y.Doc());
        const cutoff = state ? sequence(state.snapshot_cutoff) : 0;
        const rows = (await trx('board_yjs_updates')
          .where({ board_id: boardId })
          .andWhere('id', '>', cutoff)
          .orderBy('id', 'asc')
          .select('id', 'operation_id', 'update')) as UpdateRow[];

        return {
          snapshot,
          snapshotCutoff: cutoff,
          operations: rows.map((row) => ({
            sequence: sequence(row.id),
            operationId: row.operation_id,
            update: new Uint8Array(row.update)
          }))
        };
      }),

    append: async (boardId, operationId, update): Promise<AppendResult> => {
      const digest = updateDigest(update);
      const findReceipt = async (): Promise<ReceiptRow | undefined> =>
        (await db()('board_yjs_operation_receipts')
          .where({ board_id: boardId, operation_id: operationId })
          .first('operation_id', 'update_digest', 'sequence')) as ReceiptRow | undefined;
      const duplicate = (receipt: ReceiptRow): AppendResult => {
        if (receipt.update_digest !== digest) {
          throw new CollaborationFailure('malformed', 'Operation id was reused with different bytes.');
        }
        return { sequence: sequence(receipt.sequence), duplicate: true };
      };

      const existing = await findReceipt();
      if (existing) return duplicate(existing);

      try {
        return await db().transaction(async (trx) => {
          const inserted = await trx('board_yjs_updates')
            .insert({
              board_id: boardId,
              operation_id: operationId,
              update: Buffer.from(update)
            })
            .returning(['id']);
          const fresh = inserted[0] as { id: string | number };
          const freshSequence = sequence(fresh.id);
          await trx('board_yjs_operation_receipts').insert({
            board_id: boardId,
            operation_id: operationId,
            update_digest: digest,
            sequence: freshSequence
          });
          return { sequence: freshSequence, duplicate: false };
        });
      } catch (error) {
        // A competing identical append wins the receipt primary key; its
        // transaction is authoritative and this transaction rolls back.
        if ((error as { code?: string }).code !== '23505') throw error;
        const raced = await findReceipt();
        if (!raced) throw error;
        return duplicate(raced);
      }
    },

    compact: async (boardId, snapshot, cutoff): Promise<void> => {
      await db().transaction(async (trx) => {
        const updatedAt = new Date();
        await trx('board_yjs_state')
          .insert({
            board_id: boardId,
            ydoc_state: Buffer.from(snapshot),
            snapshot_cutoff: cutoff,
            updated_at: updatedAt
          })
          .onConflict('board_id')
          .merge({
            ydoc_state: Buffer.from(snapshot),
            snapshot_cutoff: cutoff,
            updated_at: updatedAt
          });

        await trx('board_yjs_updates')
          .where({ board_id: boardId })
          .andWhere('id', '<=', cutoff)
          .del();
      });
    }
  };
};
