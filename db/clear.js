// Wipes all data from the database in DATABASE_URL (structure stays intact —
// use db:migrate afterwards only if you also need to reapply schema changes),
// and flushes Redis (REDIS_URL) alongside it. Both together, always — Redis
// only ever holds session state that *references* Postgres rows (pending
// vehicle-choice/product-option lists, chosen-vehicle ids, etc; see
// session.service.ts), so clearing one without the other leaves dangling
// references: a customer with a stale pending-choice key survives the DB
// wipe and gets served phantom data (an old vehicle/product id that no
// longer exists) for up to its 4h TTL. There's no "admin data" in Redis to
// preserve the way admin_users is preserved in Postgres, so this is never
// gated behind a flag. Skipped automatically if REDIS_URL isn't set (the app
// itself falls back to an in-memory cache in that case, so there's nothing
// to flush from this process anyway — restart the app instead to clear it).
// admin_users is preserved by default so you don't get locked out of the
// admin panel; pass --all to wipe it too.
//
// Usage:
//   node db/clear.js            (asks for confirmation)
//   node db/clear.js --yes      (skips confirmation)
//   node db/clear.js --all      (also truncates admin_users)
//  npm run db:clear
// npm run db:clear -- --yes
//  npm run db:clear -- --all
import { createInterface } from 'readline/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from 'redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Create a .env file (see .env.example).');
  process.exit(1);
}

const includeAdmins = process.argv.includes('--all');
const skipConfirm = process.argv.includes('--yes') || process.argv.includes('-y');

const TABLES = [
  'orders',
  'vehicles',
  'nhtsa_vehicles',
  'sync_logs',
  'order_counters',
  'products',
  'suppliers',
  'service_providers',
  'services',
  'customers',
  ...(includeAdmins ? ['admin_users'] : []),
];

if (!skipConfirm) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const target = process.env.DATABASE_URL.replace(/:\/\/[^@]+@/, '://***@');
  console.log(`This will TRUNCATE these tables on ${target}:`);
  console.log('  ' + TABLES.join(', '));
  if (!includeAdmins) console.log('  (admin_users is kept — pass --all to wipe it too)');
  if (process.env.REDIS_URL) console.log(`This will also FLUSH Redis (${process.env.REDIS_URL}) entirely.`);
  const answer = await rl.question('Type "yes" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Aborted.');
    process.exit(0);
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  console.log(`Cleared: ${TABLES.join(', ')}`);
} catch (err) {
  console.error('Clear failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

if (process.env.REDIS_URL) {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  try {
    await redisClient.connect();
    const keyCount = (await redisClient.keys('*')).length;
    await redisClient.flushDb();
    console.log(`Flushed Redis: ${keyCount} key(s) removed`);
  } catch (err) {
    console.error('Redis flush failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (redisClient.isOpen) await redisClient.quit();
  }
}
