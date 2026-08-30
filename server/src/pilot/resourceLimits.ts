/**
 * Measured, configurable resource limits for the VVE Pilot (VVE-107).
 *
 * These are technical protection budgets, not business quotas. They must leave
 * generous headroom for a normal Lesson Session (one Teacher, up to three
 * Students, worksheets, images, and a two-to-three-hour collaboration) while
 * bounding a broken client. The 57-client capacity gate (22 Teachers + 35
 * Students) is admitted by the process and per-IP caps; it is not a per-board
 * crowd.
 *
 * Synthetic calibration, 2026-08-30, against the VVE-104 document + a stacked
 * 8-page A4 worksheet and typical phone-photo JPEGs:
 *
 * - a dense pen stroke encodes as a 0.5–8 KB Yjs update; 64 KB covers outliers
 * - a worksheet photo JPEG is 0.3–2.5 MB; 8 MB encoded is ~3× observed p95
 * - A4 raster at 1.5× is ~1240×1754 ≈ 2.2 MP; 16 MP is 4× that per image
 * - an 8-page worksheet PDF file is 3–12 MB; 25 MB is generous
 * - 57 concurrent sockets are cheap relative to document fan-out; 96 process
 *   connections leave headroom without chasing the diagnostic 88-client run
 * - per-IP 96 matches the process cap so a single CI host can run the 57-client
 *   gate and the optional 88-client observation without a false NAT deny;
 *   the previous hardcoded 20/IP would have failed that gate
 * - per-board 8 covers Teacher computer + iPad + three Students + spare
 *
 * Environment overrides (bytes, counts, milliseconds) are applied by
 * `resourceLimitsFromEnv` on the server. The frontend uses the measured
 * defaults so client admission matches server defense-in-depth.
 */

export const MEASURED_RESOURCE_LIMITS = {
  maxProcessConnections: 96,
  maxConnectionsPerIp: 96,
  maxBoardConnections: 8,
  maxMessagesPerWindow: 400,
  messageWindowMs: 1_000,
  maxWebsocketPayloadBytes: 10 * 1024 * 1024,
  maxDocumentUpdateBytes: 10 * 1024 * 1024,
  maxHydrationBytes: 64 * 1024 * 1024,
  maxEncodedImageBytes: 8 * 1024 * 1024,
  /** Data-URL character cap (base64 expansion of maxEncodedImageBytes + header). */
  maxImageDataUrlChars: 11_184_000,
  maxDecodedPixelsPerImage: 16_000_000,
  maxPdfBytes: 25 * 1024 * 1024,
  maxPdfPages: 40,
  maxExportTilePixels: 4_000_000,
  maxHttpJsonBytes: 12 * 1024 * 1024,
  maxAdminUploadBytes: 5 * 1024 * 1024,
  maxSlowClientBufferedBytes: 8 * 1024 * 1024,
  maxConcurrentArtifactJobs: 8,
  maxConcurrentArtifactJobsPerClient: 1,
  administratorLoginMax: 5,
  administratorLoginWindowMs: 60_000
} as const;

export type ResourceLimits = { [K in keyof typeof MEASURED_RESOURCE_LIMITS]: number };

const POSITIVE_KEYS: readonly (keyof ResourceLimits)[] = [
  'maxProcessConnections',
  'maxConnectionsPerIp',
  'maxBoardConnections',
  'maxMessagesPerWindow',
  'messageWindowMs',
  'maxWebsocketPayloadBytes',
  'maxDocumentUpdateBytes',
  'maxHydrationBytes',
  'maxEncodedImageBytes',
  'maxImageDataUrlChars',
  'maxDecodedPixelsPerImage',
  'maxPdfBytes',
  'maxPdfPages',
  'maxExportTilePixels',
  'maxHttpJsonBytes',
  'maxAdminUploadBytes',
  'maxSlowClientBufferedBytes',
  'maxConcurrentArtifactJobs',
  'maxConcurrentArtifactJobsPerClient',
  'administratorLoginMax',
  'administratorLoginWindowMs'
];

export const createResourceLimits = (overrides: Partial<ResourceLimits> = {}): ResourceLimits => ({
  ...MEASURED_RESOURCE_LIMITS,
  ...overrides
});

const envInteger = (name: string, fallback: number): number => {
  const source =
    typeof process !== 'undefined' && process.env ? process.env : ({} as Record<string, string | undefined>);
  const raw = source[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Server-side env overlay. Safe to call from Node; unused in the browser bundle. */
export const resourceLimitsFromEnv = (): ResourceLimits =>
  createResourceLimits({
    maxProcessConnections: envInteger('VVE_MAX_PROCESS_CONNECTIONS', MEASURED_RESOURCE_LIMITS.maxProcessConnections),
    maxConnectionsPerIp: envInteger('VVE_MAX_CONNECTIONS_PER_IP', MEASURED_RESOURCE_LIMITS.maxConnectionsPerIp),
    maxBoardConnections: envInteger('VVE_MAX_BOARD_CONNECTIONS', MEASURED_RESOURCE_LIMITS.maxBoardConnections),
    maxMessagesPerWindow: envInteger('VVE_MAX_MESSAGES_PER_WINDOW', MEASURED_RESOURCE_LIMITS.maxMessagesPerWindow),
    messageWindowMs: envInteger('VVE_MESSAGE_WINDOW_MS', MEASURED_RESOURCE_LIMITS.messageWindowMs),
    maxWebsocketPayloadBytes: envInteger(
      'VVE_MAX_WS_PAYLOAD_BYTES',
      MEASURED_RESOURCE_LIMITS.maxWebsocketPayloadBytes
    ),
    maxDocumentUpdateBytes: envInteger(
      'VVE_MAX_DOCUMENT_UPDATE_BYTES',
      MEASURED_RESOURCE_LIMITS.maxDocumentUpdateBytes
    ),
    maxHydrationBytes: envInteger('VVE_MAX_HYDRATION_BYTES', MEASURED_RESOURCE_LIMITS.maxHydrationBytes),
    maxEncodedImageBytes: envInteger('VVE_MAX_ENCODED_IMAGE_BYTES', MEASURED_RESOURCE_LIMITS.maxEncodedImageBytes),
    maxImageDataUrlChars: envInteger('VVE_MAX_IMAGE_DATA_URL_CHARS', MEASURED_RESOURCE_LIMITS.maxImageDataUrlChars),
    maxDecodedPixelsPerImage: envInteger(
      'VVE_MAX_DECODED_PIXELS_PER_IMAGE',
      MEASURED_RESOURCE_LIMITS.maxDecodedPixelsPerImage
    ),
    maxPdfBytes: envInteger('VVE_MAX_PDF_BYTES', MEASURED_RESOURCE_LIMITS.maxPdfBytes),
    maxPdfPages: envInteger('VVE_MAX_PDF_PAGES', MEASURED_RESOURCE_LIMITS.maxPdfPages),
    maxExportTilePixels: envInteger('VVE_MAX_EXPORT_TILE_PIXELS', MEASURED_RESOURCE_LIMITS.maxExportTilePixels),
    maxHttpJsonBytes: envInteger('VVE_MAX_HTTP_JSON_BYTES', MEASURED_RESOURCE_LIMITS.maxHttpJsonBytes),
    maxAdminUploadBytes: envInteger('VVE_MAX_ADMIN_UPLOAD_BYTES', MEASURED_RESOURCE_LIMITS.maxAdminUploadBytes),
    maxSlowClientBufferedBytes: envInteger(
      'VVE_MAX_SLOW_CLIENT_BUFFERED_BYTES',
      MEASURED_RESOURCE_LIMITS.maxSlowClientBufferedBytes
    ),
    maxConcurrentArtifactJobs: envInteger(
      'VVE_MAX_CONCURRENT_ARTIFACT_JOBS',
      MEASURED_RESOURCE_LIMITS.maxConcurrentArtifactJobs
    ),
    maxConcurrentArtifactJobsPerClient: envInteger(
      'VVE_MAX_CONCURRENT_ARTIFACT_JOBS_PER_CLIENT',
      MEASURED_RESOURCE_LIMITS.maxConcurrentArtifactJobsPerClient
    ),
    administratorLoginMax: envInteger('ADMIN_LOGIN_MAX', MEASURED_RESOURCE_LIMITS.administratorLoginMax),
    administratorLoginWindowMs: envInteger(
      'ADMIN_LOGIN_WINDOW_MS',
      MEASURED_RESOURCE_LIMITS.administratorLoginWindowMs
    )
  });

export const resourceLimitsAreValid = (limits: ResourceLimits): boolean =>
  POSITIVE_KEYS.every((key) => Number.isFinite(limits[key]) && limits[key] > 0);
