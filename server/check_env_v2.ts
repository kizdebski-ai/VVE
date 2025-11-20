import path from 'path';
import dotenv from 'dotenv';

console.log('--- Environment Check V2 ---');
console.log('CWD:', process.cwd());

// Try loading from default location
const result = dotenv.config();
console.log('Default dotenv result:', result.error ? 'Error: ' + result.error.message : 'Success');

// Try loading from explicit path
const explicitPath = path.join(process.cwd(), '.env');
console.log('Explicit path:', explicitPath);
const resultExplicit = dotenv.config({ path: explicitPath });
console.log('Explicit dotenv result:', resultExplicit.error ? 'Error: ' + resultExplicit.error.message : 'Success');

const key = process.env.OPENROUTER_API_KEY;
console.log('OPENROUTER_API_KEY:', key ? `Present (starts with ${key.substring(0, 5)}...)` : 'MISSING');

if (!key) {
    console.log('Checking .env file content (masked)...');
    try {
        const fs = require('fs');
        if (fs.existsSync(explicitPath)) {
            const content = fs.readFileSync(explicitPath, 'utf8');
            const lines = content.split('\n');
            const keyLine = lines.find((l: string) => l.startsWith('OPENROUTER_API_KEY='));
            if (keyLine) {
                console.log('Found key in file:', keyLine.substring(0, 25) + '...');
            } else {
                console.log('Key NOT found in file content.');
            }
        } else {
            console.log('.env file does not exist at explicit path.');
        }
    } catch (e: any) {
        console.error('Error reading file:', e.message);
    }
}
console.log('----------------------------');
