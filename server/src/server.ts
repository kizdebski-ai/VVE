/**
 * Process Adapter for RuntimeControl (VVE-108).
 *
 * Importing this module does not listen, start timers, or call process.exit.
 * The Railway / `node dist/src/server.js` entry constructs RuntimeControl and
 * routes SIGINT/SIGTERM through stop().
 */
import { createOperationalSignals } from './pilot/operationalSignals';
import { createRuntimeControl } from './pilot/runtimeControl';
import { createResourceGovernor } from './pilot/resourceGovernor';
import { resourceLimitsFromEnv } from './pilot/resourceLimits';
import { logger } from './logger';

const SHUTDOWN_GRACE_MS = 10_000;
/** Bounded final exit after stop() reports; the adapter, not RuntimeControl, owns process.exit. */
const EXIT_AFTER_STOP_MS = 1_000;

export const isProcessEntrypoint = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return /(^|[\\/])server\.(cjs|mjs|js|ts)$/.test(entry.replace(/\\/g, '/'));
};

export const createPilotRuntime = createRuntimeControl;

if (isProcessEntrypoint()) {
  const signals = createOperationalSignals();
  // One ResourceGovernor owns every product limit (VVE-107 policy); env
  // overrides apply once here and flow through RuntimeControl into the HTTP
  // app, capability access, the realtime listener, and collaboration.
  const resourceGovernor = createResourceGovernor({ limits: resourceLimitsFromEnv() });
  const runtime = createRuntimeControl({ signals, resourceGovernor });

  const requestStop = (reason: string): void => {
    void runtime
      .stop({ reason, deadline: new Date(Date.now() + SHUTDOWN_GRACE_MS) })
      .then((report) => {
        if (!report.clean) process.exitCode = 1;
        logger.info('Runtime stop report', {
          reason: report.reason,
          clean: report.clean,
          remaining: report.remaining,
          durationMs: report.durationMs
        });
        // The process adapter owns the final exit: after stop() has reported,
        // lingering third-party handles must not hold the container hostage
        // past the deadline that stop() already enforced.
        setTimeout(() => process.exit(process.exitCode ?? 0), EXIT_AFTER_STOP_MS);
      })
      .catch((error) => {
        logger.error('Runtime stop failed', { error: (error as Error).message });
        process.exitCode = 1;
        setTimeout(() => process.exit(1), EXIT_AFTER_STOP_MS);
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
