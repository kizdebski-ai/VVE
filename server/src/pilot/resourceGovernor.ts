/**
 * ResourceGovernor (VVE-107, Module 8).
 *
 * One in-process admission Interface for connections, messages, document
 * updates, decoded images, PDFs, hydration, export, slow-client buffers, and
 * Administrator login. Callers ask before they allocate; `observe` records
 * actual cost without rewriting an accepted decision. Unknown attempts, stale
 * configuration, and accounting failures fail closed. The hot path is
 * synchronous and performs no I/O. Decisions never include board content.
 */

import {
  createResourceLimits,
  resourceLimitsAreValid,
  type ResourceLimits
} from './resourceLimits';

export type ResourceAttemptKind =
  | 'connection'
  | 'message'
  | 'documentUpdate'
  | 'decodedImage'
  | 'pdf'
  | 'artifactWork'
  | 'boardHydration'
  | 'export'
  | 'slowClientBuffer'
  | 'administratorLogin';

export type ResourceMessageKey =
  | 'resource.connectionLimit'
  | 'resource.messageRate'
  | 'resource.updateTooLarge'
  | 'resource.imageTooLarge'
  | 'resource.pdfTooLarge'
  | 'resource.pdfTooManyPages'
  | 'resource.exportTooLarge'
  | 'resource.slowClient'
  | 'resource.loginRate'
  | 'resource.artifactBusy'
  | 'resource.invalidConfiguration'
  | 'resource.unknownUsage';

export const RESOURCE_MESSAGE_PL: Record<ResourceMessageKey, string> = {
  'resource.connectionLimit': 'Zbyt wiele połączeń. Spróbuj ponownie za chwilę.',
  'resource.messageRate': 'Zbyt wiele operacji naraz. Zwolnij rysowanie.',
  'resource.updateTooLarge': 'Ta zmiana jest za duża, żeby zapisać ją na tablicy.',
  'resource.imageTooLarge': 'Obraz jest za duży (wymiar lub rozmiar pliku).',
  'resource.pdfTooLarge': 'Plik PDF jest za duży, żeby go zaimportować.',
  'resource.pdfTooManyPages': 'Ten PDF ma za dużo stron, żeby go zaimportować.',
  'resource.exportTooLarge': 'Nie można przygotować PDF — tablica jest zbyt duża.',
  'resource.slowClient': 'Połączenie zostało ograniczone, bo urządzenie nie nadąża.',
  'resource.loginRate': 'Zbyt wiele prób logowania. Spróbuj ponownie za minutę.',
  'resource.artifactBusy': 'Trwa inna operacja na pliku. Poczekaj chwilę.',
  'resource.invalidConfiguration': 'Ochrona zasobów jest niegotowa. Spróbuj ponownie za chwilę.',
  'resource.unknownUsage': 'Ta operacja została odrzucona przez ochronę zasobów.'
};

export const polishResourceMessage = (key: ResourceMessageKey): string => RESOURCE_MESSAGE_PL[key];

export type ResourceAttempt = {
  kind: ResourceAttemptKind;
  bytes?: number;
  decodedPixels?: number;
  pageCount?: number;
  clientKey?: string;
  boardId?: string;
};

export type UsageContext = {
  now?: number;
};

export type ResourceBudget = {
  remainingConnections?: number;
  remainingArtifactJobs?: number;
  maxBytes?: number;
  maxPixels?: number;
  maxPages?: number;
};

export type AdmissionDecision =
  | { decision: 'allow'; reason: 'withinBudget' }
  | { decision: 'allowWithBudget'; reason: 'withinBudget'; budget: ResourceBudget }
  | {
      decision: 'retryAfter';
      reason: string;
      retryAfterMs: number;
      messageKey: ResourceMessageKey;
    }
  | { decision: 'readOnly'; reason: string; messageKey: ResourceMessageKey }
  | { decision: 'reject'; reason: string; messageKey: ResourceMessageKey };

export type ResourceSample = {
  kind:
    | ResourceAttemptKind
    | 'connectionClosed'
    | 'artifactFinished';
  bytes?: number;
  decodedPixels?: number;
  durationMs?: number;
  clientKey?: string;
  boardId?: string;
};

export interface ResourceGovernor {
  admit(attempt: ResourceAttempt, context?: UsageContext): AdmissionDecision;
  observe(sample: ResourceSample): void;
  limits(): Readonly<ResourceLimits>;
}

export interface CreateResourceGovernorOptions {
  limits?: ResourceLimits;
}

const KNOWN_ATTEMPTS: ReadonlySet<string> = new Set([
  'connection',
  'message',
  'documentUpdate',
  'decodedImage',
  'pdf',
  'artifactWork',
  'boardHydration',
  'export',
  'slowClientBuffer',
  'administratorLogin'
]);

type WindowCounter = { count: number; resetAt: number };

const reject = (reason: string, messageKey: ResourceMessageKey): AdmissionDecision => ({
  decision: 'reject',
  reason,
  messageKey
});

const retryAfter = (
  reason: string,
  messageKey: ResourceMessageKey,
  retryAfterMs: number
): AdmissionDecision => ({
  decision: 'retryAfter',
  reason,
  retryAfterMs,
  messageKey
});

const bumpWindow = (
  map: Map<string, WindowCounter>,
  key: string,
  now: number,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } => {
  const current = map.get(key);
  if (!current || current.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: windowMs };
  }
  if (current.count >= max) {
    return { allowed: false, retryAfterMs: Math.max(1, current.resetAt - now) };
  }
  current.count += 1;
  return { allowed: true, retryAfterMs: current.resetAt - now };
};

const occupancy = (map: Map<string, number>, key: string): number => map.get(key) ?? 0;

const increment = (map: Map<string, number>, key: string): void => {
  map.set(key, occupancy(map, key) + 1);
};

const decrement = (map: Map<string, number>, key: string): void => {
  const next = occupancy(map, key) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
};

export const createResourceGovernor = (
  options: CreateResourceGovernorOptions = {}
): ResourceGovernor => {
  const limits = options.limits ?? createResourceLimits();
  let processConnections = 0;
  const ipConnections = new Map<string, number>();
  const boardConnections = new Map<string, number>();
  let artifactJobs = 0;
  const artifactJobsByClient = new Map<string, number>();
  const messageWindows = new Map<string, WindowCounter>();
  const loginWindows = new Map<string, WindowCounter>();

  const conservative = (): AdmissionDecision =>
    reject('invalidConfiguration', 'resource.invalidConfiguration');

  const admit = (attempt: ResourceAttempt, context: UsageContext = {}): AdmissionDecision => {
    try {
      if (!resourceLimitsAreValid(limits)) return conservative();
      if (!KNOWN_ATTEMPTS.has(attempt.kind)) {
        return reject('unknownUsage', 'resource.unknownUsage');
      }
      const now = Number.isFinite(context.now) ? (context.now as number) : Date.now();
      const clientKey = attempt.clientKey && attempt.clientKey.length > 0 ? attempt.clientKey : 'anonymous';
      const boardId = attempt.boardId && attempt.boardId.length > 0 ? attempt.boardId : '';
      const bytes = Number.isFinite(attempt.bytes) ? (attempt.bytes as number) : 0;
      const pixels = Number.isFinite(attempt.decodedPixels) ? (attempt.decodedPixels as number) : 0;
      const pages = Number.isFinite(attempt.pageCount) ? (attempt.pageCount as number) : 0;

      switch (attempt.kind) {
        case 'connection': {
          if (processConnections >= limits.maxProcessConnections) {
            return reject('processConnectionLimit', 'resource.connectionLimit');
          }
          if (occupancy(ipConnections, clientKey) >= limits.maxConnectionsPerIp) {
            return reject('ipConnectionLimit', 'resource.connectionLimit');
          }
          if (boardId && occupancy(boardConnections, boardId) >= limits.maxBoardConnections) {
            return reject('boardConnectionLimit', 'resource.connectionLimit');
          }
          processConnections += 1;
          increment(ipConnections, clientKey);
          if (boardId) increment(boardConnections, boardId);
          return {
            decision: 'allowWithBudget',
            reason: 'withinBudget',
            budget: {
              remainingConnections: limits.maxProcessConnections - processConnections
            }
          };
        }
        case 'message': {
          const window = bumpWindow(
            messageWindows,
            clientKey,
            now,
            limits.maxMessagesPerWindow,
            limits.messageWindowMs
          );
          if (!window.allowed) {
            return retryAfter('messageRate', 'resource.messageRate', window.retryAfterMs);
          }
          if (bytes > limits.maxWebsocketPayloadBytes) {
            return reject('payloadTooLarge', 'resource.updateTooLarge');
          }
          return { decision: 'allow', reason: 'withinBudget' };
        }
        case 'documentUpdate': {
          if (bytes > limits.maxDocumentUpdateBytes) {
            return reject('updateTooLarge', 'resource.updateTooLarge');
          }
          return {
            decision: 'allowWithBudget',
            reason: 'withinBudget',
            budget: { maxBytes: limits.maxDocumentUpdateBytes }
          };
        }
        case 'decodedImage': {
          if (pixels > limits.maxDecodedPixelsPerImage || bytes > limits.maxEncodedImageBytes) {
            return reject('imageTooLarge', 'resource.imageTooLarge');
          }
          return {
            decision: 'allowWithBudget',
            reason: 'withinBudget',
            budget: {
              maxBytes: limits.maxEncodedImageBytes,
              maxPixels: limits.maxDecodedPixelsPerImage
            }
          };
        }
        case 'artifactWork':
        case 'pdf':
        case 'export': {
          if (attempt.kind === 'pdf' && bytes > limits.maxPdfBytes) {
            return reject('pdfTooLarge', 'resource.pdfTooLarge');
          }
          if (attempt.kind === 'pdf' && pages > limits.maxPdfPages) {
            return reject('pdfTooManyPages', 'resource.pdfTooManyPages');
          }
          if (attempt.kind === 'export' && pixels > limits.maxExportTilePixels * 32) {
            return reject('exportTooLarge', 'resource.exportTooLarge');
          }
          if (artifactJobs >= limits.maxConcurrentArtifactJobs) {
            return retryAfter('artifactBusy', 'resource.artifactBusy', 1_000);
          }
          if (occupancy(artifactJobsByClient, clientKey) >= limits.maxConcurrentArtifactJobsPerClient) {
            return retryAfter('artifactBusy', 'resource.artifactBusy', 1_000);
          }
          artifactJobs += 1;
          increment(artifactJobsByClient, clientKey);
          const budget: ResourceBudget = {
            remainingArtifactJobs: limits.maxConcurrentArtifactJobs - artifactJobs
          };
          if (attempt.kind === 'pdf') {
            budget.maxBytes = limits.maxPdfBytes;
            budget.maxPages = limits.maxPdfPages;
          }
          if (attempt.kind === 'export') {
            budget.maxPixels = limits.maxExportTilePixels;
          }
          return {
            decision: 'allowWithBudget',
            reason: 'withinBudget',
            budget
          };
        }
        case 'boardHydration': {
          // Persisted lessons must load even when they sit near the budget.
          // Oversize hydration is observed, not rejected.
          if (bytes > limits.maxHydrationBytes) {
            return {
              decision: 'allowWithBudget',
              reason: 'withinBudget',
              budget: { maxBytes: limits.maxHydrationBytes }
            };
          }
          return { decision: 'allow', reason: 'withinBudget' };
        }
        case 'slowClientBuffer': {
          if (bytes > limits.maxSlowClientBufferedBytes) {
            return reject('slowClient', 'resource.slowClient');
          }
          return { decision: 'allow', reason: 'withinBudget' };
        }
        case 'administratorLogin': {
          const window = bumpWindow(
            loginWindows,
            clientKey,
            now,
            limits.administratorLoginMax,
            limits.administratorLoginWindowMs
          );
          if (!window.allowed) {
            return retryAfter('loginRate', 'resource.loginRate', window.retryAfterMs);
          }
          return { decision: 'allow', reason: 'withinBudget' };
        }
      }
    } catch {
      return conservative();
    }
  };

  const observe = (sample: ResourceSample): void => {
    try {
      if (sample.kind === 'connectionClosed') {
        processConnections = Math.max(0, processConnections - 1);
        if (sample.clientKey) decrement(ipConnections, sample.clientKey);
        if (sample.boardId) decrement(boardConnections, sample.boardId);
        return;
      }
      if (sample.kind === 'artifactFinished') {
        artifactJobs = Math.max(0, artifactJobs - 1);
        if (sample.clientKey) decrement(artifactJobsByClient, sample.clientKey);
      }
    } catch {
      // Observation must never throw into a lesson path.
    }
  };

  return {
    admit,
    observe,
    limits: () => limits
  };
};
