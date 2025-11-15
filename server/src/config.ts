export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8000),
  cleanupIntervalMs: 60_000,
  roomTtlMs: 30 * 60 * 1000, // 30 minutes
  pingIntervalMs: 30_000
};

export const paths = {
  whiteboard: '/ws/whiteboard'
};
