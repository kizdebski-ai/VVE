/**
 * Shared ArtifactPipeline types, MIME validation, and Polish error keys.
 * The browser Implementation lives in `frontend/src/board/artifactPipeline.ts`;
 * this file stays dependency-free so server tests and the frontend share one
 * contract (VVE-107, Module 7).
 */

import type { ResourceMessageKey } from './resourceGovernor';

export const REQUIRED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const BEST_EFFORT_IMAGE_MIMES = ['image/svg+xml', 'image/heic', 'image/heif'] as const;
export const PDF_MIME = 'application/pdf';

export type RequiredImageMime = (typeof REQUIRED_IMAGE_MIMES)[number];
export type BestEffortImageMime = (typeof BEST_EFFORT_IMAGE_MIMES)[number];
export type ArtifactMime = typeof PDF_MIME | RequiredImageMime | BestEffortImageMime;

export type ArtifactMessageKey =
  | ResourceMessageKey
  | 'artifact.unsupportedType'
  | 'artifact.malformed'
  | 'artifact.encrypted'
  | 'artifact.cancelled'
  | 'artifact.decodeFailed'
  | 'artifact.emptyExport'
  | 'artifact.exportFailed'
  | 'artifact.importFailed'
  | 'artifact.readOnlyMutation'
  | 'artifact.committedPartial'
  | 'artifact.importComplete'
  | 'artifact.working';

export const ARTIFACT_MESSAGE_PL: Record<ArtifactMessageKey, string> = {
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
  'resource.unknownUsage': 'Ta operacja została odrzucona przez ochronę zasobów.',
  'artifact.unsupportedType': 'Ten format pliku nie jest obsługiwany. Użyj PDF, PNG, JPEG lub WebP.',
  'artifact.malformed': 'Nie udało się odczytać pliku. Sprawdź, czy nie jest uszkodzony.',
  'artifact.encrypted': 'Ten PDF jest zaszyfrowany. Usuń hasło i spróbuj ponownie.',
  'artifact.cancelled': 'Anulowano import.',
  'artifact.decodeFailed': 'Nie udało się zdekodować obrazu.',
  'artifact.emptyExport': 'Na tablicy nie ma jeszcze nic do wyeksportowania.',
  'artifact.exportFailed': 'Nie udało się przygotować pliku PDF.',
  'artifact.importFailed': 'Nie udało się zaimportować pliku.',
  'artifact.readOnlyMutation': 'Tablica jest w trybie tylko do odczytu — poczekaj na połączenie.',
  'artifact.committedPartial': 'Import przerwany. Zapisano tylko część stron.',
  'artifact.importComplete': 'Zaimportowano materiał na tablicę.',
  'artifact.working': 'Importowanie materiału…'
};

export const polishArtifactMessage = (key: ArtifactMessageKey, extras?: { committed?: number; total?: number }): string => {
  if (key === 'artifact.cancelled' && extras?.committed) {
    return extras.committed === 1
      ? 'Anulowano import. Zapisano 1 stronę.'
      : `Anulowano import. Zapisano ${extras.committed} stron.`;
  }
  if (key === 'artifact.committedPartial' && extras?.committed != null) {
    return extras.total
      ? `Import przerwany. Zapisano ${extras.committed} z ${extras.total} stron.`
      : `Import przerwany. Zapisano ${extras.committed} stron.`;
  }
  if (key === 'artifact.working' && extras?.total) {
    if (extras.total === 1) return 'Importowanie materiału…';
    return extras.committed
      ? `Importowanie PDF… strona ${extras.committed} z ${extras.total}`
      : `Importowanie PDF… 0 z ${extras.total} stron`;
  }
  if (key === 'artifact.importComplete' && extras?.committed && extras.total) {
    if (extras.total === 1 && extras.committed === 1) return 'Zaimportowano obraz na tablicę.';
    return `Zaimportowano ${extras.committed} stron z PDF.`;
  }
  return ARTIFACT_MESSAGE_PL[key];
};

export type ImportKind = 'pdf' | 'image';

export type ImportSource = {
  bytes: Uint8Array;
  fileName?: string;
  declaredMime?: string;
};

export type PlannedPage = {
  index: number;
  width: number;
  height: number;
};

export type ImportPlan = {
  kind: ImportKind;
  mime: ArtifactMime;
  fileName: string;
  byteLength: number;
  pageCount: number;
  pages: PlannedPage[];
  bestEffort: boolean;
  /** In-process bytes retained so `import` does not re-read the source. */
  bytes: Uint8Array;
};

export type ImportTarget = {
  newObjectId(): string;
  origin: { x: number; y: number };
  addImage(object: {
    id: string;
    type: 'image';
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    timestamp: number;
  }): { ok: true } | { ok: false; message: string };
  isEditable(): boolean;
};

export type ArtifactProgress = {
  phase: 'planning' | 'decoding' | 'committing' | 'done' | 'cancelled' | 'failed';
  current: number;
  total: number;
  committed: number;
  messageKey: ArtifactMessageKey;
  message: string;
  objectIds: string[];
};

export type ExportMode = 'single' | 'paged';

export type ExportOptions = {
  mode: ExportMode;
  filename?: string;
  smoothingFactor?: number;
  signal?: AbortSignal;
};

export type ExportArtifact = {
  bytes: Uint8Array;
  mime: 'application/pdf';
  filename: string;
  pageCount: number;
};

export type ArtifactError = {
  key: ArtifactMessageKey;
  message: string;
};

export type DetectedFormat =
  | { ok: true; mime: ArtifactMime; bestEffort: boolean }
  | { ok: false; key: ArtifactMessageKey };

const startsWith = (bytes: Uint8Array, signature: number[] | string, offset = 0): boolean => {
  if (typeof signature === 'string') {
    if (bytes.length < offset + signature.length) return false;
    for (let i = 0; i < signature.length; i += 1) {
      if (bytes[offset + i] !== signature.charCodeAt(i)) return false;
    }
    return true;
  }
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
};

const asciiSlice = (bytes: Uint8Array, start: number, end: number): string => {
  const limit = Math.min(end, bytes.length);
  let text = '';
  for (let i = start; i < limit; i += 1) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text;
};

export const detectArtifactFormat = (bytes: Uint8Array, declaredMime?: string): DetectedFormat => {
  if (!bytes.length) return { ok: false, key: 'artifact.malformed' };
  if (startsWith(bytes, '%PDF')) return { ok: true, mime: 'application/pdf', bestEffort: false };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, mime: 'image/png', bestEffort: false };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ok: true, mime: 'image/jpeg', bestEffort: false };
  if (startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)) {
    return { ok: true, mime: 'image/webp', bestEffort: false };
  }
  if (startsWith(bytes, 'GIF8')) return { ok: false, key: 'artifact.unsupportedType' };
  const brand = asciiSlice(bytes, 4, 16);
  if (brand.includes('ftyp') && /heic|heif|mif1|msf1/i.test(brand + asciiSlice(bytes, 8, 24))) {
    return { ok: true, mime: 'image/heic', bestEffort: true };
  }
  const head = asciiSlice(bytes, 0, Math.min(bytes.length, 256)).trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return { ok: true, mime: 'image/svg+xml', bestEffort: true };
  }
  if (declaredMime === 'application/pdf') return { ok: false, key: 'artifact.malformed' };
  if (declaredMime && (REQUIRED_IMAGE_MIMES as readonly string[]).includes(declaredMime)) {
    return { ok: false, key: 'artifact.malformed' };
  }
  return { ok: false, key: 'artifact.unsupportedType' };
};

export interface ArtifactPipeline {
  planImport(source: ImportSource): Promise<ImportPlan>;
  import(plan: ImportPlan, target: ImportTarget, signal?: AbortSignal): AsyncIterable<ArtifactProgress>;
  export(
    scene: readonly Record<string, unknown>[],
    options: ExportOptions
  ): Promise<ExportArtifact>;
}
