export interface BoardRecord {
  id: string;
  organization_id: string | null;
  teacher_id: string;
  student_id: string | null;
  title: string | null;
  public_slug: string | null;
  student_token_hash: string;
  created_at: Date;
  valid_until: Date;
  archived_at: Date | null;
  deleted_at: Date | null;
}

export interface BoardWithStudent extends BoardRecord {
  student_name: string | null;
}
