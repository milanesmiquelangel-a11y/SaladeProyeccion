import { randomUUID } from 'node:crypto';
import { dbQuery, databaseConfigured, withTransaction } from './database.js';

const FREE_CREDITS = 30;

export { databaseConfigured };

function accountFromRow(row) {
  return { credits: Number(row.credits || 0), plan: row.plan || 'Gratis', totalConsumed: Number(row.total_consumed || 0), createdAt: new Date(row.created_at).getTime(), nextRechargeAt: null };
}

async function ensureAccount(client, userId) {
  const existing = await client.query('SELECT * FROM sala_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    // Migrate old free accounts from the previous 24-hour recharge model.
    // The presence of next_recharge_at marks an account created under that model.
    if (row.plan === 'Gratis' && row.next_recharge_at) {
      row.credits = FREE_CREDITS;
      row.next_recharge_at = null;
      await client.query('UPDATE sala_accounts SET credits = $2, next_recharge_at = NULL WHERE user_id = $1', [userId, FREE_CREDITS]);
    }
    return row;
  }
  const now = new Date();
  const inserted = await client.query(`INSERT INTO sala_accounts (user_id, credits, plan, total_consumed, created_at, next_recharge_at) VALUES ($1, $2, 'Gratis', 0, $3, NULL) RETURNING *`, [userId, FREE_CREDITS, now]);
  return inserted.rows[0];
}

export async function getAccount(userId) {
  if (!userId) throw new Error('Cuenta no identificada.');
  return withTransaction(async (client) => {
    const row = await ensureAccount(client, userId);
    return accountFromRow(row);
  });
}

export async function reserveGeneration(userId, cost, route) {
  if (!userId || !Number.isInteger(cost) || cost <= 0) throw new Error('Datos de reserva inválidos.');
  await recoverStaleGenerationReservations(userId);
  return withTransaction(async (client) => {
    const row = await ensureAccount(client, userId);
    if (Number(row.credits) < cost) {
      const error = new Error(`Créditos insuficientes. Esta generación necesita ${cost} crédito${cost === 1 ? '' : 's'} y tienes ${row.credits}.`);
      error.code = 'INSUFFICIENT_CREDITS'; error.credits = Number(row.credits); error.required = cost; error.nextRechargeAt = null;
      throw error;
    }
    const transactionId = randomUUID();
    const now = new Date();
    await client.query('UPDATE sala_accounts SET credits = credits - $2, total_consumed = total_consumed + $2, last_generation_at = $3 WHERE user_id = $1', [userId, cost, now]);
    await client.query(`INSERT INTO sala_transactions (id, user_id, type, route, cost, credits, status, created_at) VALUES ($1, $2, 'generation', $3, $4, 0, 'reserved', $5)`, [transactionId, userId, route || null, cost, now]);
    return { transactionId, credits: Number(row.credits) - cost, cost };
  });
}

export async function creditAccount(userId, credits, payment = {}) {
  if (!userId || !Number.isInteger(credits) || credits <= 0) throw new Error('Datos de crédito inválidos.');
  return withTransaction(async (client) => {
    if (payment.eventId) { const duplicate = await client.query('SELECT id FROM sala_payments WHERE event_id = $1', [payment.eventId]); if (duplicate.rowCount) return { alreadyProcessed: true }; }
    const row = await ensureAccount(client, userId);
    const now = new Date(); const newCredits = Number(row.credits) + credits;
    await client.query('UPDATE sala_accounts SET credits = $2, last_credit_at = $3, plan = COALESCE($4, plan) WHERE user_id = $1', [userId, newCredits, now, payment.plan || null]);
    await client.query(`INSERT INTO sala_transactions (id, user_id, type, cost, credits, status, payment_id, created_at) VALUES ($1, $2, 'credit', $3, $4, 'completed', $5, $6)`, [randomUUID(), userId, -credits, credits, payment.paymentId || null, now]);
    await client.query(`INSERT INTO sala_payments (id, user_id, provider, event_id, plan, credits, status, created_at) VALUES ($1, $2, 'stripe', $3, $4, 'completed', $5, $6)`, [payment.paymentId || randomUUID(), userId, payment.eventId || null, payment.plan || null, credits, now]);
    return { alreadyProcessed: false, credits: newCredits };
  });
}

export async function finalizeGeneration(userId, transactionId) {
  if (!userId || !transactionId) return { finalized: false, reason: 'missing_data' };
  return withTransaction(async (client) => {
    const result = await client.query(`UPDATE sala_transactions SET status = 'completed', completed_at = NOW() WHERE id = $1 AND user_id = $2 AND type = 'generation' AND status = 'reserved' RETURNING id`, [transactionId, userId]);
    if (!result.rowCount) { const current = await client.query('SELECT status FROM sala_transactions WHERE id = $1 AND user_id = $2', [transactionId, userId]); if (current.rows[0]?.status === 'refunded') return { finalized: false, reason: 'already_refunded' }; return { finalized: false, reason: 'missing_transaction' }; }
    return { finalized: true };
  });
}

export async function refundGeneration(userId, transactionId, reason = 'generation_failed') {
  if (!userId || !transactionId) return { refunded: false, reason: 'missing_data' };
  return withTransaction(async (client) => {
    const txResult = await client.query('SELECT * FROM sala_transactions WHERE id = $1 AND user_id = $2 AND type = $3 FOR UPDATE', [transactionId, userId, 'generation']);
    const tx = txResult.rows[0];
    if (!tx || tx.status === 'refunded' || tx.status === 'completed') return { refunded: false, reason: 'already_finalized_or_missing' };
    const account = await client.query('SELECT * FROM sala_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!account.rowCount) return { refunded: false, reason: 'account_missing' };
    const cost = Number(tx.cost || 0);
    await client.query('UPDATE sala_accounts SET credits = credits + $2, total_consumed = GREATEST(0, total_consumed - $2) WHERE user_id = $1', [userId, cost]);
    await client.query('UPDATE sala_transactions SET status = $2, refunded_at = NOW(), reason = $3 WHERE id = $1', [transactionId, 'refunded', reason]);
    await client.query(`INSERT INTO sala_transactions (id, user_id, type, cost, credits, status, related_transaction_id, reason, created_at) VALUES ($1, $2, 'refund', 0, $3, 'completed', $4, $5, NOW())`, [randomUUID(), userId, cost, transactionId, reason]);
    const updated = await client.query('SELECT credits FROM sala_accounts WHERE user_id = $1', [userId]);
    return { refunded: true, credits: Number(updated.rows[0].credits) };
  });
}

export async function recoverStaleGenerationReservations(userId) {
  if (!userId || !databaseConfigured()) return 0;
  const result = await dbQuery(`SELECT id FROM sala_transactions WHERE user_id = $1 AND type = 'generation' AND status = 'reserved' AND created_at <= NOW() - INTERVAL '20 minutes'`, [userId]);
  let recovered = 0;
  for (const row of result.rows) { const refund = await refundGeneration(userId, row.id, 'stale_generation_timeout'); if (refund.refunded) recovered += 1; }
  return recovered;
}
