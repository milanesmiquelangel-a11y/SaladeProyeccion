import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbQuery, databaseConfigured } from './database.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminPage = path.join(__dirname, '..', 'public', 'admin.html');
const COOKIE = 'sala_admin_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim();
}

function configured() {
  return Boolean(adminPassword());
}

function sign(value) {
  return crypto.createHmac('sha256', adminPassword()).update(value).digest('hex');
}

function makeSession() {
  const payload = `${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

function validSession(req) {
  if (!configured()) return false;
  const cookies = String(req.headers.cookie || '').split(';').reduce((out, part) => {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1));
    return out;
  }, {});
  const token = cookies[COOKIE];
  if (!token) return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return false; }
  const timestamp = Number(String(payload).split(':', 1)[0]);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > SESSION_MS || Date.now() - timestamp < 0) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireAdmin(req, res, next) {
  if (!configured()) return res.status(503).json({ error: 'Administración no configurada. Define ADMIN_PASSWORD en Render.' });
  if (!validSession(req)) return res.status(401).json({ error: 'Sesión de administrador no válida.' });
  next();
}

function jsonError(res, error) {
  console.error('Admin API error:', error);
  return res.status(503).json({ error: error?.message || 'No se pudo consultar la administración.' });
}

router.get('/', (_req, res) => res.sendFile(adminPage));

router.post('/api/admin/login', (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Configura ADMIN_PASSWORD en Render antes de entrar al panel.' });
  const password = String(req.body?.password || '');
  const expected = adminPassword();
  const given = Buffer.from(password);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
  const token = makeSession();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`);
  return res.json({ ok: true });
});

router.post('/api/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

router.get('/api/admin/me', (req, res) => {
  res.json({ configured: configured(), authenticated: validSession(req) });
});

router.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  if (!databaseConfigured()) return res.status(503).json({ error: 'DATABASE_URL no está configurada.' });
  try {
    const [accounts, credits, transactions, payments, activity] = await Promise.all([
      dbQuery('SELECT COUNT(*)::int AS count FROM sala_accounts'),
      dbQuery('SELECT COALESCE(SUM(credits),0)::int AS credits, COALESCE(SUM(total_consumed),0)::int AS consumed FROM sala_accounts'),
      dbQuery("SELECT COUNT(*)::int AS count, COALESCE(SUM(cost),0)::int AS cost FROM sala_transactions WHERE status = 'completed'"),
      dbQuery('SELECT COUNT(*)::int AS count, COALESCE(SUM(credits),0)::int AS credits FROM sala_payments WHERE status = $1', ['completed']),
      dbQuery('SELECT id, user_id AS "userId", type, route, cost, credits, status, created_at AS "createdAt", completed_at AS "completedAt", reason FROM sala_transactions ORDER BY created_at DESC LIMIT 25')
    ]);
    return res.json({
      accounts: accounts.rows[0],
      credits: credits.rows[0],
      generations: transactions.rows[0],
      payments: payments.rows[0],
      activity: activity.rows
    });
  } catch (error) { return jsonError(res, error); }
});

router.get('/api/admin/users', requireAdmin, async (_req, res) => {
  if (!databaseConfigured()) return res.status(503).json({ error: 'DATABASE_URL no está configurada.' });
  try {
    const result = await dbQuery('SELECT user_id AS "userId", credits, plan, total_consumed AS "totalConsumed", created_at AS "createdAt", next_recharge_at AS "nextRechargeAt", last_generation_at AS "lastGenerationAt" FROM sala_accounts ORDER BY created_at DESC LIMIT 200');
    return res.json({ users: result.rows });
  } catch (error) { return jsonError(res, error); }
});

router.get('/api/admin/transactions', requireAdmin, async (_req, res) => {
  if (!databaseConfigured()) return res.status(503).json({ error: 'DATABASE_URL no está configurada.' });
  try {
    const result = await dbQuery('SELECT id, user_id AS "userId", type, route, cost, credits, status, payment_id AS "paymentId", reason, created_at AS "createdAt", completed_at AS "completedAt", refunded_at AS "refundedAt" FROM sala_transactions ORDER BY created_at DESC LIMIT 200');
    return res.json({ transactions: result.rows });
  } catch (error) { return jsonError(res, error); }
});

export default router;
