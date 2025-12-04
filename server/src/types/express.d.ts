import type { TeacherRecord } from '../models/teacher';
import type { BoardRecord } from '../models/board';

declare module 'express-serve-static-core' {
  interface Request {
    teacher?: TeacherRecord;
    board?: BoardRecord;
    boardRole?: 'teacher' | 'student';
  }
}

export {};
