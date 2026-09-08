import express from 'express';
import crypto from 'node:crypto';
import { BILLING_CONFIG, billingIsConfigured } from './billing-config.js';

const router = express.Router();

function disabled(res, message = 'Pagos no configurados todavía.') {
  return res.status(503).json({ error: message, provider: BILLING_CONFIG.provider, configured: false });
}

function configured(req, res, next) {
  if (!billingIsConfigured()) return disabled(res);
  next();
}

function priceIdFor(planId) {
  return planId === 'creator' ? process.env.STRIPE_PRICE_CREATOR : planId === 'pro' ? process.env.STRIPE_PRICE_PRO : null;
}

async function stripeRequest(endpoint, options = {}) {
  const auth = Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString('base64');
  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    ...options,
    headers: { Authorization: `Basic ${auth}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe respondió HTTP ${response.status}.`);
  return data;
}

router.post('/checkout', configured, async (req, res) => {
  const planId = String(req.body?.plan || '').toLowerCase();
  const plan = BILLING_CONFIG.plans[planId];
  const priceId = priceIdFor(planId);
  if (!plan || !priceId) return res.status(400).json({ error: 'Plan no válido o Price ID de Stripe no configurado.' });

  try {
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.set('success_url', process.env.STRIPE_SUCCESS_URL || 'https://sala-de-proyeccion.onrender.com/?billing=success');
    params.set('cancel_url', process.env.STRIPE_CANCEL_URL || 'https://sala-de-proyeccion.onrender.com/?billing=cancel');
    params.set('client_reference_id', String(req.get('x-sala-user-id') || 'anonymous'));
    params.set('metadata[plan]', planId);
    params.set('metadata[credits]', String(plan.credits));
    const session = await stripeRequest('checkout/sessions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    return res.json({ checkoutUrl: session.url, sessionId: session.id, plan: planId });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(502).json({ error: error.message || 'No se pudo crear el checkout de Stripe.' });
  }
});

router.post('/portal', configured, async (_req, res) => {
  return disabled(res, 'El portal de facturación se habilitará cuando exista un Customer de Stripe asociado a la cuenta.');
});

function validStripeSignature(rawBody, header, secret) {
  const parts = String(header || '').split(',').map((item) => item.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return signatures.some((candidate) => candidate.length === expected.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)));
}

router.post('/webhook', async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook de Stripe no configurado.', configured: false });
  const rawBody = req.rawBody;
  const signature = req.get('stripe-signature');
  if (!rawBody || !validStripeSignature(rawBody, signature, secret)) return res.status(400).json({ error: 'Firma de webhook de Stripe no válida.' });

  const event = req.body || {};
  if (event.type === 'checkout.session.completed') {
    console.log('Stripe checkout completed:', event.id, event.data?.object?.id);
  }
  return res.json({ received: true, eventId: event.id || null });
});

export default router;
