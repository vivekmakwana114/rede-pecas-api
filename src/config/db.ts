import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.db.url,
  ssl: config.env === 'production' && !config.db.url?.includes('localhost') ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

db.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});
