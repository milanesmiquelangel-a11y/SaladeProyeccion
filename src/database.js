import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: connectionString.includes('render.com') || process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

let schemaPromise = null;

export function databaseConfigured() {
  return Boolean(pool);
}

export async function checkDatabase() {
  if (!pool) return { configured: false, connected: false, error: 'DATABASE_URL no está configurada.' };
  try {
    await ensureSchema();
    await pool.query('SELECT 1');
    return { configured: true, connected: true, error: null };
  } catch (error) {
    console.error('PostgreSQL health check error:', error);
    return { configured: true, connected: false, error: error?.message || 'No se pudo conectar con PostgreSQL.' };
  }
}

export async function dbQuery(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL no está configurada. Conecta una base de datos PostgreSQL de Render.');
  await ensureSchema();
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  if (!pool) throw new Error('DATABASE_URL no está configurada. Conecta una base de datos PostgreSQL de Render.');
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL no está configurada.');
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sala_accounts (
          user_id TEXT PRIMARY KEY,
          credits INTEGER NOT NULL DEFAULT 3,
          plan TEXT NOT NULL DEFAULT 'Gratis',
          total_consumed INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          next_recharge_at TIMESTAMPTZ,
          last_credit_at TIMESTAMPTZ,
          last_generation_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS sala_transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES sala_accounts(user_id),
          type TEXT NOT NULL,
          route TEXT,
          cost INTEGER NOT NULL DEFAULT 0,
          credits INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          payment_id TEXT,
          related_transaction_id TEXT,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          refunded_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS sala_transactions_user_created_idx ON sala_transactions(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS sala_transactions_reserved_idx ON sala_transactions(user_id, type, status, created_at);
        CREATE TABLE IF NOT EXISTS sala_payments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES sala_accounts(user_id),
          provider TEXT NOT NULL,
          event_id TEXT UNIQUE,
          plan TEXT,
          credits INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function closeDatabase() {
  if (pool) await pool.end();
}
