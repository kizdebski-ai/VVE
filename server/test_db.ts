import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;
const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function testConnection() {
    try {
        await client.connect();
        console.log('Connected successfully');
        await client.end();
    } catch (err) {
        console.error('Connection failed', err);
    }
}

testConnection();
