const PAYPAL_BASE_URL = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let tokenCache = { accessToken: null, expiresAt: 0 };

export function paypalCredentialsConfigured() {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET
  );
}

export function paypalConfigured() {
  return Boolean(
    paypalCredentialsConfigured() &&
    process.env.PAYPAL_CREATOR_PLAN_ID &&
    process.env.PAYPAL_PRO_PLAN_ID
  );
}

export function paypalStatus() {
  return {
    provider: 'paypal',
    mode: process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
    configured: paypalConfigured(),
    requirements: {
      clientId: Boolean(process.env.PAYPAL_CLIENT_ID),
      clientSecret: Boolean(process.env.PAYPAL_CLIENT_SECRET),
      creatorPlanId: Boolean(process.env.PAYPAL_CREATOR_PLAN_ID),
      proPlanId: Boolean(process.env.PAYPAL_PRO_PLAN_ID),
      webhookId: Boolean(process.env.PAYPAL_WEBHOOK_ID)
    }
  };
}

async function paypalAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.message || `PayPal OAuth respondió HTTP ${response.status}.`);
  }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  };
  return tokenCache.accessToken;
}

export async function paypalRequest(path, options = {}) {
  const accessToken = await paypalAccessToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(`${PAYPAL_BASE_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details?.[0];
    const description = detail?.description || data?.message || data?.name;
    const field = detail?.field ? ` Campo: ${detail.field}.` : '';
    const debug = data?.debug_id ? ` (debug_id: ${data.debug_id})` : '';
    throw new Error(`${description || `PayPal respondió HTTP ${response.status}.`}${field}${debug}`);
  }
  return data;
}

export function paypalPlanId(planId) {
  if (planId === 'creator') return process.env.PAYPAL_CREATOR_PLAN_ID || null;
  if (planId === 'pro') return process.env.PAYPAL_PRO_PLAN_ID || null;
  return null;
}

async function activatePayPalPlan(planId) {
  return paypalRequest(`/v1/billing/plans/${encodeURIComponent(planId)}/activate`, {
    method: 'POST'
  });
}

async function resolvePayPalPlan(planId) {
  const configuredId = paypalPlanId(planId);
  const expectedName = planId === 'creator'
    ? 'Sala de Proyección Creador'
    : 'Sala de Proyección Pro';

  // First try the ID configured in Render. If it is malformed, stale, or
  // belongs to another sandbox app, fall back to the actual plan in PayPal.
  if (configuredId && /^P-[A-Z0-9]+$/.test(configuredId)) {
    try {
      const existing = await paypalRequest(`/v1/billing/plans/${encodeURIComponent(configuredId)}`, { method: 'GET' });
      const status = String(existing?.status || '').toUpperCase();
      if (status !== 'ACTIVE') await activatePayPalPlan(configuredId).catch(() => {});
      return configuredId;
    } catch (_error) {
      // Continue with discovery below.
    }
  }

  const productResponse = await paypalRequest('/v1/catalogs/products?page_size=20&page=1&total_required=true', { method: 'GET' });
  const product = Array.isArray(productResponse?.products)
    ? productResponse.products.find((item) => item.name === 'Sala de Proyección')
    : null;
  if (!product?.id) throw new Error(`No se encontró el producto de PayPal para el plan ${planId}.`);

  const planResponse = await paypalRequest(`/v1/billing/plans?page_size=20&page=1&total_required=true&product_id=${encodeURIComponent(product.id)}`, { method: 'GET' });
  const found = Array.isArray(planResponse?.plans)
    ? planResponse.plans.find((item) => item.name === expectedName && item.product_id === product.id)
    : null;
  if (!found?.id) throw new Error(`No se encontró en PayPal el plan ${expectedName}.`);

  const status = String(found.status || '').toUpperCase();
  if (status !== 'ACTIVE') {
    try {
      await activatePayPalPlan(found.id);
    } catch (error) {
      if (!/already active|active plan|invalid plan status/i.test(String(error.message || ''))) throw error;
    }
  }
  return found.id;
}

export async function paypalPlanKind(planId) {
  if (!planId) return null;
  if (planId === process.env.PAYPAL_CREATOR_PLAN_ID) return 'creator';
  if (planId === process.env.PAYPAL_PRO_PLAN_ID) return 'pro';

  try {
    const plan = await paypalRequest(`/v1/billing/plans/${encodeURIComponent(planId)}`, { method: 'GET' });
    const name = String(plan?.name || '');
    if (name === 'Sala de Proyección Creador') return 'creator';
    if (name === 'Sala de Proyección Pro') return 'pro';
  } catch (_error) {
    // Unknown plan; webhook caller will ignore it safely.
  }
  return null;
}

export async function setupPayPalPlans() {
  if (!paypalCredentialsConfigured()) {
    throw new Error('Faltan PAYPAL_CLIENT_ID y/o PAYPAL_CLIENT_SECRET.');
  }

  const productResponse = await paypalRequest('/v1/catalogs/products?page_size=20&page=1&total_required=true', {
    method: 'GET'
  });
  const existingProducts = Array.isArray(productResponse?.products) ? productResponse.products : [];
  let product = existingProducts.find((item) => item.name === 'Sala de Proyección');

  if (!product) {
    product = await paypalRequest('/v1/catalogs/products', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': 'sala-de-proyeccion-product-v1' },
      body: JSON.stringify({
        name: 'Sala de Proyección',
        description: 'Suscripciones mensuales para Sala de Proyección',
        type: 'SERVICE',
        category: 'SOFTWARE',
        home_url: process.env.PUBLIC_APP_URL || 'https://sala-de-proyeccion.onrender.com'
      })
    });
  }

  const productId = product?.id;
  if (!productId) throw new Error('PayPal no devolvió el ID del producto.');

  const planResponse = await paypalRequest(`/v1/billing/plans?page_size=20&page=1&total_required=true&product_id=${encodeURIComponent(productId)}`, {
    method: 'GET'
  });
  const existingPlans = Array.isArray(planResponse?.plans) ? planResponse.plans : [];

  async function ensurePlan(configuredPlanId, name, description, price) {
    let planId = configuredPlanId || null;
    let existing = planId ? existingPlans.find((item) => item.id === planId) : null;
    if (!existing) existing = existingPlans.find((item) => item.name === name && item.product_id === productId);
    if (!planId && existing?.id) planId = existing.id;

    if (!planId) {
      const created = await paypalRequest('/v1/billing/plans', {
        method: 'POST',
        headers: { 'PayPal-Request-Id': `sala-de-proyeccion-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v2` },
        body: JSON.stringify({
          product_id: productId,
          name,
          description,
          billing_cycles: [{
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: { value: price, currency_code: process.env.BILLING_CURRENCY || 'EUR' }
            }
          }],
          payment_preferences: {
            auto_bill_outstanding: true,
            payment_failure_threshold: 1
          }
        })
      });
      planId = created?.id || null;
      existing = created;
    }

    if (!planId) throw new Error(`PayPal no devolvió el ID del plan ${name}.`);

    const status = String(existing?.status || '').toUpperCase();
    if (status !== 'ACTIVE') {
      try {
        await activatePayPalPlan(planId);
      } catch (error) {
        if (!/already active|active plan|invalid plan status/i.test(String(error.message || ''))) throw error;
      }
    }
    return planId;
  }

  const creatorPlanId = await ensurePlan(
    process.env.PAYPAL_CREATOR_PLAN_ID,
    'Sala de Proyección Creador',
    'Plan mensual Creador con 30 créditos',
    '4.99'
  );
  const proPlanId = await ensurePlan(
    process.env.PAYPAL_PRO_PLAN_ID,
    'Sala de Proyección Pro',
    'Plan mensual Pro con 100 créditos',
    '14.99'
  );

  return { productId, creatorPlanId, proPlanId };
}

const PAYPAL_WEBHOOK_EVENTS = [
  'PAYMENT.SALE.COMPLETED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
];

export async function setupPayPalWebhook() {
  if (!paypalCredentialsConfigured()) {
    throw new Error('Faltan PAYPAL_CLIENT_ID y/o PAYPAL_CLIENT_SECRET.');
  }

  const url = `${process.env.PUBLIC_APP_URL || 'https://sala-de-proyeccion.onrender.com'}/api/billing/webhook`;
  const list = await paypalRequest('/v1/notifications/webhooks?page_size=20&page=1', { method: 'GET' });
  const existing = Array.isArray(list?.webhooks)
    ? list.webhooks.find((webhook) => webhook.url === url)
    : null;

  if (existing?.id) {
    return { webhookId: existing.id, url, created: false, eventTypes: existing.event_types || [] };
  }

  const created = await paypalRequest('/v1/notifications/webhooks', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': 'sala-de-proyeccion-webhook-v1' },
    body: JSON.stringify({
      url,
      event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name }))
    })
  });

  if (!created?.id) throw new Error('PayPal no devolvió el ID del webhook.');
  return { webhookId: created.id, url, created: true, eventTypes: created.event_types || PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })) };
}

export async function createPayPalSubscription({ planId, accountId, email }) {
  const paypalPlan = await resolvePayPalPlan(planId);
  if (!paypalPlan) throw new Error('Plan de PayPal no configurado.');
  const baseUrl = process.env.PUBLIC_APP_URL || 'https://sala-de-proyeccion.onrender.com';
  const body = {
    plan_id: paypalPlan,
    custom_id: accountId,
    subscriber: { email_address: email },
    application_context: {
      brand_name: 'Sala de Proyección',
      user_action: 'SUBSCRIBE_NOW',
      return_url: `${baseUrl}/?billing=success&provider=paypal`,
      cancel_url: `${baseUrl}/?billing=cancel&provider=paypal`
    }
  };
  return paypalRequest('/v1/billing/subscriptions', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `sala-${accountId}-${planId}-${Date.now()}` },
    body: JSON.stringify(body)
  });
}

export async function getPayPalSubscription(subscriptionId) {
  return paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' });
}

export async function verifyPayPalWebhook({ headers, event }) {
  if (!process.env.PAYPAL_WEBHOOK_ID) return false;
  const required = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event
  };
  if (Object.values(required).some((value) => !value)) return false;
  const result = await paypalRequest('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify(required)
  });
  return result?.verification_status === 'SUCCESS';
}
