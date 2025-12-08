export interface TeacherRecord {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: Date;
  last_login_at: Date | null;
  permanent_token_hash: string | null;
}

export interface TeacherMagicLinkRecord {
  id: string;
  teacher_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  user_agent: string | null;
  ip_addr: string | null;
}

export interface BoardAccessLogRecord {
  id?: number;
  board_id: string | null;
  actor_type: 'teacher' | 'student';
  actor_id: string | null;
  at?: Date;
  ip_addr: string | null;
  user_agent: string | null;
}
