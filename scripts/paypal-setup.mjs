const mode = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const currency = process.env.BILLING_CURRENCY || 'EUR';

if (!clientId || !clientSecret) {
  console.error('Faltan PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET.');
  process.exit(1);
}

async function token() {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data?.error_description || data?.message || `OAuth HTTP ${response.status}`);
  return data.access_token;
}

async function api(path, accessToken, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.details?.[0]?.description || data?.message || data?.name || `PayPal HTTP ${response.status}`);
  return data;
}

async function findProduct(accessToken) {
  const data = await api('/v1/catalogs/products?page_size=20&page=1', accessToken, { method: 'GET' });
  return data.products?.find((item) => item.name === 'Sala de Proyección AI') || null;
}

async function createProduct(accessToken) {
  const existing = await findProduct(accessToken);
  if (existing) return existing;
  return api('/v1/catalogs/products', accessToken, {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `sala-product-${Date.now()}` },
    body: JSON.stringify({
      name: 'Sala de Proyección AI',
      description: 'AI video generation studio with monthly credit plans.',
      type: 'SERVICE',
      category: 'SOFTWARE',
      home_url: process.env.PUBLIC_APP_URL || 'https://sala-de-proyeccion.onrender.com/'
    })
  });
}

async function findPlan(accessToken, name) {
  const data = await api('/v1/billing/plans?page_size=20&page=1', accessToken, { method: 'GET' });
  return data.plans?.find((item) => item.name === name && item.status === 'ACTIVE') || null;
}

async function createPlan(accessToken, productId, { id, name, description, price }) {
  const existing = await findPlan(accessToken, name);
  if (existing) return existing;
  return api('/v1/billing/plans', accessToken, {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `sala-plan-${id}-${Date.now()}` },
    body: JSON.stringify({
      product_id: productId,
      name,
      description,
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: price, currency_code: currency } }
      }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 }
    })
  });
}

const accessToken = await token();
const product = await createProduct(accessToken);
const creator = await createPlan(accessToken, product.id, {
  id: 'creator',
  name: 'Sala Creator',
  description: '30 video credits per monthly billing cycle.',
  price: '4.99'
});
const pro = await createPlan(accessToken, product.id, {
  id: 'pro',
  name: 'Sala Pro',
  description: '100 video credits per monthly billing cycle.',
  price: '14.99'
});

console.log('\nPayPal setup complete.\n');
console.log(`PAYPAL_PRODUCT_ID=${product.id}`);
console.log(`PAYPAL_CREATOR_PLAN_ID=${creator.id}`);
console.log(`PAYPAL_PRO_PLAN_ID=${pro.id}`);
console.log('\nAñade estos tres valores a Render como Environment Variables. No los pongas en GitHub.');
