const PAYPAL_BASE_URL = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let tokenCache = { accessToken: null, expiresAt: 0 };

export function paypalConfigured() {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
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
    const detail = data?.details?.[0]?.description || data?.message || data?.name;
    throw new Error(detail || `PayPal respondió HTTP ${response.status}.`);
  }
  return data;
}

export function paypalPlanId(planId) {
  if (planId === 'creator') return process.env.PAYPAL_CREATOR_PLAN_ID || null;
  if (planId === 'pro') return process.env.PAYPAL_PRO_PLAN_ID || null;
  return null;
}

export async function createPayPalSubscription({ planId, accountId, email }) {
  const paypalPlan = paypalPlanId(planId);
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
