export const BILLING_CONFIG = Object.freeze({
  currency: process.env.BILLING_CURRENCY || 'EUR',
  provider: process.env.BILLING_PROVIDER || 'paypal',
  enabled: process.env.BILLING_ENABLED !== 'false',
  plans: {
    creator: { name: 'Creador', priceCents: 499, credits: 30 },
    pro: { name: 'Pro', priceCents: 1499, credits: 100 }
  }
});

export function billingIsConfigured() {
  if (!BILLING_CONFIG.enabled) return false;
  if (BILLING_CONFIG.provider === 'paypal') {
    return Boolean(
      process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET &&
      process.env.PAYPAL_CREATOR_PLAN_ID &&
      process.env.PAYPAL_PRO_PLAN_ID
    );
  }
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
