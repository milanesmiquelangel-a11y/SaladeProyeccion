import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import billingRouter from './billing-routes.js';
import { refundGeneration } from './billing-ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const ledgerPath = path.join(dataDir, 'billing.json');
const originalPost = express.application.post;
const originalGet = express.application.get;
const originalListen = express.application.listen;
let writeQueue = Promise.resolve();
const FREE_CREDITS = 3;
const FREE_RECHARGE_MS = 24 * 60 * 60 * 1000;
const STALE_GENERATION_MS = 20 * 60 * 1000;

async function readLedger() {
  try { return JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
  catch { return { users: {}, transactions: [], payments: [], processedEvents: [] }; }
}
function queueWrite(data) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(ledgerPath, JSON.stringify(data, null, 2), 'utf8');
  });
  return writeQueue;
}
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

async function recoverStaleGenerationReservations(userIdValue) {
  if (!userIdValue) return 0;
  const ledger = await readLedger();
  const cutoff = Date.now() - STALE_GENERATION_MS;
  const stale = (Array.isArray(ledger.transactions) ? ledger.transactions : [])
    .filter((tx) => tx.userId === userIdValue && tx.type === 'generation' && tx.status === 'reserved' && Number(tx.createdAt || 0) <= cutoff);
  let recovered = 0;
  for (const tx of stale) {
    try {
      const result = await refundGeneration(userIdValue, tx.id, 'stale_generation_timeout');
      if (result?.refunded) recovered += 1;
    } catch (error) {
      console.error('Stale generation refund error:', error);
    }
  }
  return recovered;
}

async function billingMiddleware(req, res, next) {
  const id = userId(req);
  if (!id) return res.status(400).json({ error: 'Falta el identificador de cuenta. Recarga la página e inténtalo de nuevo.' });
  await recoverStaleGenerationReservations(id);
  const ledger = await readLedger();
  const account = accountFor(ledger, id);
  const recharged = applyFreeRecharge(account);
  const cost = generationCost(req);
  if (account.credits < cost) {
    if (recharged) { ledger.users[id] = account; await queueWrite(ledger); }
    const rechargeText = account.plan === 'Gratis' && account.nextRechargeAt
      ? ` Próxima recarga gratuita: ${new Date(account.nextRechargeAt).toLocaleString('es-ES')}.`
      : '';
    return res.status(402).json({ error: `Créditos insuficientes. Esta generación necesita ${cost} crédito${cost === 1 ? '' : 's'} y tienes ${account.credits}.${rechargeText}`, credits: account.credits, required: cost, nextRechargeAt: account.nextRechargeAt || null });
  }
  const transactionId = randomUUID();
  account.credits -= cost;
  account.totalConsumed += cost;
  account.lastGenerationAt = Date.now();
  ledger.users[id] = account;
  ledger.transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  ledger.transactions.push({ id: transactionId, userId: id, type: 'generation', route: req.path, cost, status: 'reserved', createdAt: Date.now() });
  if (ledger.transactions.length > 5000) ledger.transactions = ledger.transactions.slice(-5000);
  await queueWrite(ledger);
  req.salaBillingUserId = id;
  req.salaBillingTransactionId = transactionId;
  res.set('X-Sala-Credits', String(account.credits));
  res.set('X-Sala-Cost', String(cost));
  res.set('X-Sala-Transaction-Id', transactionId);
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      refundGeneration(id, transactionId, `http_${res.statusCode}`).catch((error) => console.error('Billing refund error:', error));
    }
  });
  next();
}

function accountFor(ledger, id) {
  return ledger.users[id] || {
    credits: FREE_CREDITS,
    plan: 'Gratis',
    totalConsumed: 0,
    createdAt: Date.now(),
    nextRechargeAt: Date.now() + FREE_RECHARGE_MS
  };
}
function applyFreeRecharge(account, now = Date.now()) {
  if (account.plan !== 'Gratis') return false;
  const next = Number(account.nextRechargeAt || 0);
  if (!next || now < next) return false;
  account.credits = Math.min(FREE_CREDITS, Math.max(0, Number(account.credits) || 0) + FREE_CREDITS);
  account.nextRechargeAt = now + FREE_RECHARGE_MS;
  return true;
}

express.application.post = function patchedPost(route, ...handlers) {
  if (route === '/api/video/generate' || route === '/api/video/sequence') handlers.unshift(billingMiddleware);
  return originalPost.call(this, route, ...handlers);
};

express.application.get = function patchedGet(route, ...handlers) {
  const result = originalGet.call(this, route, ...handlers);
  if (route === '/api/health') {
    originalGet.call(this, '/api/billing/balance', async (req, res) => {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'Cuenta no identificada.' });
      await recoverStaleGenerationReservations(id);
      const ledger = await readLedger();
      const account = accountFor(ledger, id);
      const recharged = applyFreeRecharge(account);
      if (recharged || !ledger.users[id]) { ledger.users[id] = account; await queueWrite(ledger); }
      return res.json({ credits: account.credits, plan: account.plan, totalConsumed: account.totalConsumed || 0, nextRechargeAt: account.plan === 'Gratis' ? account.nextRechargeAt : null, freeRechargeCredits: FREE_CREDITS });
    });
    originalGet.call(this, '/api/billing/transactions', async (req, res) => {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'Cuenta no identificada.' });
      const ledger = await readLedger();
      const items = (Array.isArray(ledger.transactions) ? ledger.transactions : []).filter((item) => item.userId === id).slice(-50).reverse();
      return res.json({ transactions: items });
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

await import('./server.js');