import crypto from 'node:crypto';
import { dbQuery, withTransaction } from './database.js';

const SESSION_COOKIE = 'sala_session';
const SESSION_DAYS = 30;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(email) {
  return email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived.toString('hex'));
    });
  });
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

export async function ensureAuthSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS sala_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sala_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES sala_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sala_sessions_user_idx ON sala_sessions(user_id);
    CREATE INDEX IF NOT EXISTS sala_sessions_expires_idx ON sala_sessions(expires_at);
  `);
}

export async function registerUser(emailInput, password) {
  const email = normalizeEmail(emailInput);
  if (!validEmail(email)) throw Object.assign(new Error('Introduce un correo electrónico válido.'), { code: 'INVALID_EMAIL' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw Object.assign(new Error('La contraseña debe tener entre 8 y 200 caracteres.'), { code: 'INVALID_PASSWORD' });
  const userId = crypto.randomUUID().replaceAll('-', '');
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(password, salt);
  return withTransaction(async (client) => {
    await ensureAuthSchema(client);
    try {
      await client.query('INSERT INTO sala_users (id, email, password_hash, password_salt) VALUES ($1, $2, $3, $4)', [userId, email, passwordHash, salt]);
      const now = new Date();
      const nextRecharge = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await client.query(`INSERT INTO sala_accounts (user_id, credits, plan, total_consumed, created_at, next_recharge_at) VALUES ($1, 3, 'Gratis', 0, $2, $3) ON CONFLICT (user_id) DO NOTHING`, [userId, now, nextRecharge]);
      return { id: userId, email };
    } catch (error) {
      if (error?.code === '23505') throw Object.assign(new Error('Ese correo ya está registrado.'), { code: 'EMAIL_EXISTS' });
      throw error;
    }
  });
}

export async function loginUser(emailInput, password) {
  const email = normalizeEmail(emailInput);
  if (!validEmail(email) || typeof password !== 'string') throw Object.assign(new Error('Correo o contraseña incorrectos.'), { code: 'INVALID_CREDENTIALS' });
  const result = await dbQuery('SELECT id, email, password_hash, password_salt FROM sala_users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user) throw Object.assign(new Error('Correo o contraseña incorrectos.'), { code: 'INVALID_CREDENTIALS' });
  const candidate = await hashPassword(password, user.password_salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(user.password_hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('Correo o contraseña incorrectos.'), { code: 'INVALID_CREDENTIALS' });
  return createSession(user.id, user.email);
}

export async function createSession(userId, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await dbQuery('INSERT INTO sala_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expires]);
  return { token, expiresAt: expires.getTime(), user: { id: userId, email } };
}

export async function getSession(req) {
  const cookies = parseCookies(req.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const result = await dbQuery(`SELECT u.id, u.email, s.expires_at FROM sala_sessions s JOIN sala_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [hashToken(token)]);
  if (!result.rowCount) return null;
  return { id: result.rows[0].id, email: result.rows[0].email, expiresAt: new Date(result.rows[0].expires_at).getTime() };
}

export async function getAuthenticatedUserId(req) {
  const session = await getSession(req);
  return session?.id || null;
}

export async function logoutUser(req, res) {
  const cookies = parseCookies(req.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (token) await dbQuery('DELETE FROM sala_sessions WHERE token_hash = $1', [hashToken(token)]);
  setSessionCookie(res, '', 0);
}

export function authRouter(express) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/me', async (req, res) => {
    try {
      const user = await getSession(req);
      if (!user) return res.status(401).json({ authenticated: false });
      return res.json({ authenticated: true, user: { id: user.id, email: user.email }, expiresAt: user.expiresAt });
    } catch (error) {
      console.error('Auth session error:', error);
      return res.status(503).json({ error: 'No se pudo comprobar la sesión.' });
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const user = await registerUser(req.body?.email, req.body?.password);
      const session = await createSession(user.id, user.email);
      setSessionCookie(res, session.token, SESSION_DAYS * 24 * 60 * 60);
      return res.status(201).json({ authenticated: true, user: session.user, expiresAt: session.expiresAt });
    } catch (error) {
      console.error('Auth registration error:', error);
      const status = ['INVALID_EMAIL', 'INVALID_PASSWORD'].includes(error?.code) ? 400 : error?.code === 'EMAIL_EXISTS' ? 409 : 503;
      return res.status(status).json({ error: error.message || 'No se pudo crear la cuenta.' });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const session = await loginUser(req.body?.email, req.body?.password);
      setSessionCookie(res, session.token, SESSION_DAYS * 24 * 60 * 60);
      return res.json({ authenticated: true, user: session.user, expiresAt: session.expiresAt });
    } catch (error) {
      const status = error?.code === 'INVALID_CREDENTIALS' ? 401 : 503;
      if (status === 503) console.error('Auth login error:', error);
      return res.status(status).json({ error: status === 401 ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión.' });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      await logoutUser(req, res);
      return res.json({ authenticated: false });
    } catch (error) {
      console.error('Auth logout error:', error);
      return res.status(503).json({ error: 'No se pudo cerrar la sesión.' });
    }
  });

  return router;
}

export { SESSION_COOKIE };
