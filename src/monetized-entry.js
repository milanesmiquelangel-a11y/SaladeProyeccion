import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const ledgerPath = path.join(dataDir, 'billing.json');
const originalPost = express.application.post;
const originalGet = express.application.get;
let writeQueue = Promise.resolve();

async function readLedger() {
  try { return JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
  catch { return { users: {} }; }
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
async function billingMiddleware(req, res, next) {
  const id = userId(req);
  if (!id) return res.status(400).json({ error: 'Falta el identificador de cuenta. Recarga la página e inténtalo de nuevo.' });
  const ledger = await readLedger();
  const account = ledger.users[id] || { credits: 3, plan: 'Gratis', totalConsumed: 0, createdAt: Date.now() };
  const cost = generationCost(req);
  if (account.credits < cost) return res.status(402).json({ error: `Créditos insuficientes. Esta generación necesita ${cost} crédito${cost === 1 ? '' : 's'} y tienes ${account.credits}.`, credits: account.credits, required: cost });
  account.credits -= cost;
  account.totalConsumed += cost;
  account.lastGenerationAt = Date.now();
  ledger.users[id] = account;
  await queueWrite(ledger);
  res.set('X-Sala-Credits', String(account.credits));
  res.set('X-Sala-Cost', String(cost));
  next();
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
      const ledger = await readLedger();
      const account = ledger.users[id] || { credits: 3, plan: 'Gratis', totalConsumed: 0 };
      return res.json({ credits: account.credits, plan: account.plan, totalConsumed: account.totalConsumed || 0 });
    });
  }
  return result;
};

await import('./server.js');
