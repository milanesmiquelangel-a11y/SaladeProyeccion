import crypto from 'node:crypto';
import express from 'express';
import { BILLING_CONFIG, billingIsConfigured } from './billing-config.js';

const router = express.Router();

function disabled(res) {
  return res.status(503).json({
    error: 'Pagos no configurados todavía.',
    provider: BILLING_CONFIG.provider,
    configured: false
  });
}

function configured(req, res, next) {
  if (!billingIsConfigured()) return disabled(res);
  next();
}

// Never accept a price/amount from the browser. The server selects the plan.
router.post('/checkout', configured, async (req, res) => {
  const planId = String(req.body?.plan || '').toLowerCase();
  const plan = BILLING_CONFIG.plans[planId];
  if (!plan) return res.status(400).json({ error: 'Plan no válido.' });

  // Stripe Checkout implementation is intentionally gated until STRIPE_SECRET_KEY
  // and real Stripe Price IDs are configured on Render.
  return res.status(503).json({
    error: 'Checkout preparado pero requiere configuración de Stripe Price ID.',
    plan: planId,
    priceCents: plan.priceCents,
    credits: plan.credits,
    configured: false
  });
});

router.post('/portal', configured, async (_req, res) => {
  return res.status(503).json({ error: 'Portal de facturación pendiente de configuración.', configured: false });
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook de Stripe no configurado.', configured: false });
  if (!signature) return res.status(400).json({ error: 'Falta la firma de Stripe.' });

  // Minimal signature gate. Full event/idempotency handling will be enabled when
  // the Stripe secret and Price IDs are supplied.
  const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!signature.includes(expected)) return res.status(400).json({ error: 'Firma de webhook no válida.' });

  return res.json({ received: true, processed: false });
});

export default router;
