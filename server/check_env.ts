import dotenv from 'dotenv';
import path from 'path';

console.log('Current directory:', process.cwd());
const envPath = path.join(process.cwd(), '.env');
console.log('Loading .env from:', envPath);

const result = dotenv.config();

if (result.error) {
    console.error('Error loading .env:', result.error);
} else {
    console.log('.env loaded successfully');
}

const apiKey = process.env.OPENROUTER_API_KEY;
console.log('OPENROUTER_API_KEY present:', !!apiKey);
if (apiKey) {
    console.log('OPENROUTER_API_KEY length:', apiKey.length);
    console.log('OPENROUTER_API_KEY prefix:', apiKey.substring(0, 10) + '...');
}
