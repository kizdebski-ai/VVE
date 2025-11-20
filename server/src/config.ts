import path from 'path';
import dotenv from 'dotenv';

const result = dotenv.config();

console.log('--- Config Debug ---');
console.log('CWD:', process.cwd());
console.log('Dotenv result:', result.error ? 'Error: ' + result.error.message : 'Success');
console.log('Parsed env keys:', result.parsed ? Object.keys(result.parsed) : 'None');
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
