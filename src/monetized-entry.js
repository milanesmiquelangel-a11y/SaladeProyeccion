import express from 'express';
import './image-video-entry.js';
import billingRouter from './billing-routes.js';
import { dbQuery, databaseConfigured } from './database.js';
import { getAccount, reserveGeneration, refundGeneration, recoverStaleGenerationReservations } from './billing-ledger.js';

const originalPost = express.application.post;
const originalGet = express.application.get;
const originalListen = express.application.listen;
const FREE_CREDITS = 3;

function userId(req) {
  const raw = String(req.get('x-sala-user-id') || '').trim();
  return /^[a-zA-Z0-9_-]{16,80}$/.test(raw) ? raw : null;
}

function generationCost(req) {
  const body = req.body || {};
  const highMultiplier = body.resolution === 'high' ? 2 : 1;
  if (req.path === '/api/video/sequence') return Math.max(1, Math.ceil(Number(body.duration) / 5 || 1)) * highMultiplier;
  return highMultiplier;
}

async function billingMiddleware(req, res, next) {
  const id = userId(req);
  if (!id) return res.status(400).json({ error: 'Falta el identificador de cuenta. Recarga la página e inténtalo de nuevo.' });
  if (!databaseConfigured()) return res.status(503).json({ error: 'La facturación necesita una base de datos PostgreSQL de Render. Configura DATABASE_URL antes de generar vídeos.', billingPersistence: false });
  const cost = generationCost(req);
  try {
    await recoverStaleGenerationReservations(id);
    const reservation = await reserveGeneration(id, cost, req.path);
    req.salaBillingUserId = id;
    req.salaBillingTransactionId = reservation.transactionId;
    res.set('X-Sala-Credits', String(reservation.credits));
    res.set('X-Sala-Cost', String(reservation.cost));
    res.set('X-Sala-Transaction-Id', reservation.transactionId);
    res.on('finish', () => {
      if (res.statusCode >= 500) refundGeneration(id, reservation.transactionId, `http_${res.statusCode}`).catch((error) => console.error('Billing refund error:', error));
    });
    return next();
  } catch (error) {
    if (error.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ error: error.message, credits: error.credits, required: error.required, nextRechargeAt: error.nextRechargeAt });
    }
    console.error('Billing reservation error:', error);
    return res.status(503).json({ error: 'No se pudo reservar el crédito de esta generación. Inténtalo de nuevo.', billingPersistence: true });
  }
}

express.application.post = function patchedPost(route, ...handlers) {
  if (route === '/api/video/generate' || route === '/api/video/sequence' || route === '/api/video/image-to-video') handlers.unshift(billingMiddleware);
  return originalPost.call(this, route, ...handlers);
};

express.application.get = function patchedGet(route, ...handlers) {
  const result = originalGet.call(this, route, ...handlers);
  if (route === '/api/health') {
    originalGet.call(this, '/api/billing/balance', async (req, res) => {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'Cuenta no identificada.' });
      if (!databaseConfigured()) return res.status(503).json({ error: 'Base de datos no configurada.', billingPersistence: false });
      try {
        await recoverStaleGenerationReservations(id);
        const account = await getAccount(id);
        return res.json({ credits: account.credits, plan: account.plan, totalConsumed: account.totalConsumed, nextRechargeAt: account.plan === 'Gratis' ? account.nextRechargeAt : null, freeRechargeCredits: FREE_CREDITS });
      } catch (error) {
        console.error('Billing balance error:', error);
        return res.status(503).json({ error: 'No se pudo consultar el saldo.' });
      }
    });
    originalGet.call(this, '/api/billing/transactions', async (req, res) => {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'Cuenta no identificada.' });
      if (!databaseConfigured()) return res.status(503).json({ error: 'Base de datos no configurada.', billingPersistence: false });
      try {
        const result = await dbQuery(`SELECT id, type, route, cost, credits, status, payment_id AS "paymentId", related_transaction_id AS "relatedTransactionId", reason, created_at AS "createdAt", completed_at AS "completedAt", refunded_at AS "refundedAt" FROM sala_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]);
        return res.json({ transactions: result.rows });
      } catch (error) {
        console.error('Billing transactions error:', error);
        return res.status(503).json({ error: 'No se pudo consultar el historial de créditos.' });
      }
    });
  }
  return result;
};

express.application.listen = function patchedListen(...args) {
  if (!this._salaBillingMounted) {
    this.use('/api/billing', billingRouter);
    this._salaBillingMounted = true;
  }
  return originalListen.apply(this, args);
};

const nativeFetch = globalThis.fetch.bind(globalThis);
const PIXAZO_STATUS_HOST = 'gateway.pixazo.ai/v2/requests/status/';
const PIXAZO_STATUS_TIMEOUT_MS = 30 * 1000;
const PIXAZO_STATUS_RETRIES = 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }
  try {
    return await nativeFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    if (timedOut) throw Object.assign(new Error('La consulta de estado de Pixazo tardó demasiado.'), { code: 'PIXAZO_STATUS_TIMEOUT' });
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const inputMethod = typeof input?.method === 'string' ? input.method : 'GET';
  const method = String(init.method || inputMethod).toUpperCase();
  const isStatusPoll = method === 'GET' && url.includes(PIXAZO_STATUS_HOST);
  if (!isStatusPoll) return nativeFetch(input, init);
  let lastError = null;
  for (let attempt = 0; attempt <= PIXAZO_STATUS_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, PIXAZO_STATUS_TIMEOUT_MS);
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`Pixazo devolvió HTTP ${response.status} al consultar el estado.`);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
    }
    if (attempt < PIXAZO_STATUS_RETRIES) await sleep(2000 * (attempt + 1));
  }
  throw lastError || new Error('No se pudo consultar el estado de Pixazo.');
};

await import('./server.js');
