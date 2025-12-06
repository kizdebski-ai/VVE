import crypto, { timingSafeEqual } from 'crypto';

const WS_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

export interface BoardWsTokenPayload {
  boardId: string;
  role: 'teacher' | 'student';
  exp: number;
}

const sign = (payload: string) => {
  const secret = process.env.BOARD_WS_SECRET || process.env.TEACHER_SESSION_SECRET || 'change-me';
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
};

export const createBoardWsToken = (boardId: string, role: 'teacher' | 'student', ttlMs = WS_TTL_MS) => {
  const payload: BoardWsTokenPayload = {
    boardId,
    role,
    exp: Date.now() + ttlMs
  };
  const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(base);
  return `${base}.${signature}`;
};

export const verifyBoardWsToken = (token: string): BoardWsTokenPayload | null => {
  const [base, signature] = token.split('.');
  if (!base || !signature) return null;
  const expected = sign(base);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8')) as BoardWsTokenPayload;
    if (!payload.boardId || !payload.role || typeof payload.exp !== 'number') {
      return null;
    }
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};
