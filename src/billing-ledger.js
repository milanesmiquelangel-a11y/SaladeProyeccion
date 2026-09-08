import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ledgerPath = path.join(__dirname, 'data', 'billing.json');
let queue = Promise.resolve();

async function read() {
  try { return JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
  catch { return { users: {}, transactions: [], payments: [], processedEvents: [] }; }
}
async function write(data) {
  queue = queue.then(async () => {
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(ledgerPath, JSON.stringify(data, null, 2), 'utf8');
  });
  await queue;
}

export async function creditAccount(userId, credits, payment = {}) {
  if (!userId || !Number.isInteger(credits) || credits <= 0) throw new Error('Datos de crédito inválidos.');
  const ledger = await read();
  ledger.users = ledger.users || {};
  ledger.transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  ledger.payments = Array.isArray(ledger.payments) ? ledger.payments : [];
  ledger.processedEvents = Array.isArray(ledger.processedEvents) ? ledger.processedEvents : [];
  const eventId = payment.eventId || null;
  if (eventId && ledger.processedEvents.includes(eventId)) return { alreadyProcessed: true };
  const account = ledger.users[userId] || { credits: 0, plan: 'Gratis', totalConsumed: 0, createdAt: Date.now() };
  account.credits = Number(account.credits || 0) + credits;
  account.lastCreditAt = Date.now();
  if (payment.plan) account.plan = payment.plan;
  ledger.users[userId] = account;
  ledger.transactions.push({ id: randomUUID(), userId, type: 'credit', cost: -credits, credits, status: 'completed', paymentId: payment.paymentId || null, createdAt: Date.now() });
  ledger.payments.push({ id: payment.paymentId || randomUUID(), userId, provider: 'stripe', eventId, plan: payment.plan || null, credits, status: 'completed', createdAt: Date.now() });
  if (eventId) ledger.processedEvents.push(eventId);
  ledger.processedEvents = ledger.processedEvents.slice(-5000);
  ledger.transactions = ledger.transactions.slice(-5000);
  ledger.payments = ledger.payments.slice(-5000);
  await write(ledger);
  return { alreadyProcessed: false, credits: account.credits };
}

export async function refundGeneration(userId, transactionId, reason = 'generation_failed') {
  if (!userId || !transactionId) return { refunded: false, reason: 'missing_data' };
  const ledger = await read();
  ledger.users = ledger.users || {};
  ledger.transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  const tx = ledger.transactions.find((item) => item.id === transactionId && item.userId === userId && item.type === 'generation');
  if (!tx || tx.status === 'refunded') return { refunded: false, reason: 'already_refunded_or_missing' };
  const account = ledger.users[userId];
  if (!account) return { refunded: false, reason: 'account_missing' };
  account.credits = Number(account.credits || 0) + Number(tx.cost || 0);
  tx.status = 'refunded';
  tx.refundedAt = Date.now();
  ledger.transactions.push({ id: randomUUID(), userId, type: 'refund', cost: 0, credits: Number(tx.cost || 0), status: 'completed', relatedTransactionId: transactionId, reason, createdAt: Date.now() });
  ledger.users[userId] = account;
  ledger.transactions = ledger.transactions.slice(-5000);
  await write(ledger);
  return { refunded: true, credits: account.credits };
}
