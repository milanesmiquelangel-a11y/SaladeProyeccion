import express from 'express';
import { BILLING_CONFIG, billingIsConfigured } from './billing-config.js';
import { creditAccount } from './billing-ledger.js';
import { dbQuery } from './database.js';
import { createPayPalSubscription, getPayPalSubscription, paypalConfigured, paypalPlanId, paypalPlanKind, paypalStatus, setupPayPalPlans, setupPayPalWebhook, verifyPayPalWebhook } from './paypal-billing.js';

const router = express.Router();

function disabled(res, message = 'Pagos no configurados todavía.') {
  return res.status(503).json({ error: message, provider: BILLING_CONFIG.provider, configured: false });
}

function configured(_req, res, next) {
  if (!billingIsConfigured()) return disabled(res, 'PayPal todavía no está configurado. Faltan las credenciales y/o los IDs de los planes.');
  next();
}

router.get('/status', (_req, res) => {
  const status = paypalStatus();
  res.json({
    ...status,
    enabled: BILLING_CONFIG.enabled,
    currency: BILLING_CONFIG.currency,
    plans: Object.fromEntries(Object.entries(BILLING_CONFIG.plans).map(([id, plan]) => [id, {
      name: plan.name,
      priceCents: plan.priceCents,
      credits: plan.credits,
      planConfigured: Boolean(paypalPlanId(id))
    }]))
  });
});

// One-time setup helper for Render Free instances where Shell is unavailable.
// The authentication bridge supplies x-sala-user-id from the active session.
router.get('/paypal/setup', async (req, res) => {
  const accountId = String(req.get('x-sala-user-id') || '').trim();
  if (!accountId || !/^[a-zA-Z0-9_-]{16,80}$/.test(accountId)) {
    return res.status(401).json({ error: 'Inicia sesión en Sala de Proyección antes de ejecutar la configuración de PayPal.' });
  }
  try {
    const plans = await setupPayPalPlans();
    const webhook = await setupPayPalWebhook();
    return res.json({
      ok: true,
      message: 'Planes y webhook de PayPal creados o encontrados. Guarda estos IDs en Render.',
      ...plans,
      ...webhook
    });
  } catch (error) {
    console.error('PayPal setup error:', error);
    return res.status(502).json({ error: error.message || 'No se pudieron configurar los planes/webhook de PayPal.' });
  }
});

router.post('/checkout', configured, async (req, res) => {
  const planId = String(req.body?.plan || '').toLowerCase();
  const plan = BILLING_CONFIG.plans[planId];
  const accountId = String(req.get('x-sala-user-id') || '').trim();
  if (!accountId || !/^[a-zA-Z0-9_-]{16,80}$/.test(accountId)) return res.status(401).json({ error: 'Cuenta no autenticada.' });
  if (!plan || !paypalPlanId(planId)) return res.status(400).json({ error: 'Plan no válido o plan de PayPal no configurado.' });
  try {
    const user = await dbQuery('SELECT email FROM sala_users WHERE id = $1 LIMIT 1', [accountId]);
    const email = user.rows[0]?.email;
    if (!email) return res.status(404).json({ error: 'No se encontró el correo de la cuenta.' });
    const subscription = await createPayPalSubscription({ planId, accountId, email });
    const approvalUrl = subscription?.links?.find((link) => link.rel === 'approve')?.href;
    if (!approvalUrl) return res.status(502).json({ error: 'PayPal no devolvió la dirección de aprobación.' });
    return res.json({ checkoutUrl: approvalUrl, subscriptionId: subscription.id, plan: planId, provider: 'paypal' });
  } catch (error) {
    console.error('PayPal checkout error:', error);
    return res.status(502).json({ error: error.message || 'No se pudo iniciar la suscripción con PayPal.' });
  }
});

router.post('/portal', configured, (_req, res) => {
  res.status(501).json({ error: 'La gestión del plan se realizará desde PayPal por ahora.', provider: 'paypal' });
});

async function subscriptionContext(subscriptionId) {
  if (!subscriptionId) return null;
  const subscription = await getPayPalSubscription(subscriptionId);
  const planId = String(subscription?.plan_id || '').trim();
  const accountId = String(subscription?.custom_id || '').trim();
  const plan = await paypalPlanKind(planId);
  return { subscription, planId, accountId, plan };
}

router.post('/webhook', async (req, res) => {
  if (!paypalConfigured() || !process.env.PAYPAL_WEBHOOK_ID) {
    return res.status(503).json({ error: 'Webhook de PayPal no configurado.', configured: false });
  }

  const event = req.body || {};
  try {
    const verified = await verifyPayPalWebhook({ headers: req.headers, event });
    if (!verified) return res.status(400).json({ error: 'Firma de webhook de PayPal no válida.' });

    const eventType = String(event.event_type || '');
    const resource = event.resource || {};
    const subscriptionId = resource.billing_agreement_id || resource.id || resource.subscription_id || null;
    const context = await subscriptionContext(subscriptionId);

    if (!context?.accountId) {
      console.warn('PayPal webhook without internal account:', event.id, eventType);
      return res.json({ received: true, eventId: event.id || null, credited: false });
    }

    if (eventType === 'PAYMENT.SALE.COMPLETED') {
      if (!context.plan) return res.status(400).json({ error: 'Pago de PayPal asociado a un plan desconocido.' });
      const plan = BILLING_CONFIG.plans[context.plan];
      const result = await creditAccount(context.accountId, plan.credits, {
        provider: 'paypal',
        eventId: event.id,
        paymentId: resource.id || subscriptionId,
        plan: context.plan
      });
      return res.json({ received: true, eventId: event.id || null, credited: !result.alreadyProcessed });
    }

    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' || eventType === 'BILLING.SUBSCRIPTION.UPDATED') {
      if (context.plan) {
        await dbQuery('UPDATE sala_accounts SET plan = $2 WHERE user_id = $1', [context.accountId, BILLING_CONFIG.plans[context.plan].name]);
      }
    }

    if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED' || eventType === 'BILLING.SUBSCRIPTION.EXPIRED' || eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      await dbQuery('UPDATE sala_accounts SET plan = $2 WHERE user_id = $1', [context.accountId, 'Gratis']);
    }

    return res.json({ received: true, eventId: event.id || null, credited: false });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return res.status(500).json({ error: 'No se pudo procesar el webhook de PayPal.' });
  }
});

export default router;
