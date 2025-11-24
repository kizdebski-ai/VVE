import path from 'path';
import dotenv from 'dotenv';

const envFiles = ['.env', '.env.secrets'];
const searchDirs = [process.cwd(), path.resolve(__dirname, '..')];
const loadedEnvFiles: Array<{ filename: string; path: string; loaded: boolean; parsedKeys: string[] }> = [];
const resolvedPaths = new Set<string>();

for (const dir of searchDirs) {
  for (const filename of envFiles) {
    const envPath = path.join(dir, filename);
    const normalizedPath = path.normalize(envPath);
    if (resolvedPaths.has(normalizedPath)) {
      continue;
    }
    resolvedPaths.add(normalizedPath);
    const result = dotenv.config({ path: normalizedPath });
    const error = result.error as NodeJS.ErrnoException | undefined;
    if (error && error.code !== 'ENOENT') {
      console.warn(`Failed to load ${filename} at ${normalizedPath}:`, error.message);
    }
    loadedEnvFiles.push({
      filename,
      path: normalizedPath,
      loaded: !result.error && Boolean(result.parsed),
      parsedKeys: result.parsed ? Object.keys(result.parsed) : []
    });
  }
}

console.log('--- Config Debug ---');
console.log('CWD:', process.cwd());
const loadedNames = loadedEnvFiles.filter((entry) => entry.loaded).map((entry) => entry.path);
console.log('Env files loaded:', loadedNames.length ? loadedNames.join(', ') : 'None');
const parsedKeys = loadedEnvFiles.flatMap((entry) => entry.parsedKeys);
console.log('Parsed env keys:', parsedKeys.length ? parsedKeys : 'None');
console.log('OPENROUTER_API_KEY from process.env:', process.env.OPENROUTER_API_KEY ? 'Present' : 'Missing');
console.log('--------------------');

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8000),
  cleanupIntervalMs: 60_000,
  roomTtlMs: 24 * 60 * 60 * 1000, // 24 hours (increased for persistence)
  pingIntervalMs: 30_000,
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ocrModel: process.env.OCR_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free',
  solverModel: process.env.SOLVER_MODEL || 'deepseek/deepseek-r1:free'
};

export const paths = {
  whiteboard: '/ws/whiteboard'
};
