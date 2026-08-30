export interface BoardRecord {
  id: string;
  organization_id: string | null;
  teacher_id: string;
  /** 'managed' (one Owning Teacher, twelve-month Board Access) or 'personal' (VVE-102). */
  kind: 'personal' | 'managed';
  title: string | null;
  /** Student Label (CONTEXT.md) — internal, Teacher-facing only. */
  student_label: string | null;
  /** Managed Boards only; a Personal Board is not addressable by public slug. */
  public_slug: string | null;
  /** Retrievable random Board Access token (VVE-101, ADR-0008 analogue); personal boards have none. */
  student_token: string | null;
  created_at: Date;
  /** Managed Boards: created + 12 months. Personal Boards: null (never expire). */
  valid_until: Date | null;
  deleted_at: Date | null;
  /** Durable Board Access credential version (regeneration bumps it atomically). */
  access_credential_version: number;
  /** End Board Access timestamp; set ends access immediately (BoardLifecycle owns transitions). */
  access_ended_at: Date | null;
  /** Scheduled permanent deletion: accessEndedAt + 7 days (ADR-0006). */
  delete_after: Date | null;
}
