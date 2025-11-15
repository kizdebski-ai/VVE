/* Simple tagged logger */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const shouldDebug = process.env.DEBUG?.toLowerCase() === 'true';

const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
  if (level === 'debug' && !shouldDebug) return;
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  const stamp = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${stamp}] [${level.toUpperCase()}] ${message}${payload}`
  );
};

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta)
};
