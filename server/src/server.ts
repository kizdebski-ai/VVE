/**
 * Process Adapter for RuntimeControl (VVE-108).
 *
 * Importing this module does not listen, start timers, or call process.exit.
 * The Railway / `node dist/src/server.js` entry constructs RuntimeControl and
 * routes SIGINT/SIGTERM through stop().
 */
import { createOperationalSignals } from './pilot/operationalSignals';
import { createRuntimeControl } from './pilot/runtimeControl';
import { logger } from './logger';

const SHUTDOWN_GRACE_MS = 10_000;

export const isProcessEntrypoint = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return /(^|[\\/])server\.(cjs|mjs|js|ts)$/.test(entry.replace(/\\/g, '/'));
};

export const createPilotRuntime = createRuntimeControl;

if (isProcessEntrypoint()) {
  const signals = createOperationalSignals();
  const runtime = createRuntimeControl({ signals });

  const requestStop = (reason: string): void => {
    void runtime
      .stop({ reason, deadline: new Date(Date.now() + SHUTDOWN_GRACE_MS) })
      .then((report) => {
        if (!report.clean) process.exitCode = 1;
      })
      .catch((error) => {
        logger.error('Runtime stop failed', { error: (error as Error).message });
        process.exitCode = 1;
      });
  };

  process.on('SIGINT', () => requestStop('SIGINT'));
  process.on('SIGTERM', () => requestStop('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    signals.record({
      name: 'process.phase',
      dimensions: { phase: 'unhandledRejection', error: String(reason).slice(0, 200) }
    });
  });
  process.on('uncaughtException', (error) => {
    signals.record({
      name: 'process.phase',
      dimensions: { phase: 'uncaughtException', error: error.message.slice(0, 200) }
    });
    requestStop('uncaughtException');
  });

  runtime.start().catch((error) => {
    logger.error('Runtime start failed', { error: (error as Error).message });
    process.exitCode = 1;
  });
}
