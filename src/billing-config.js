export const BILLING_CONFIG = Object.freeze({
  currency: process.env.BILLING_CURRENCY || 'EUR',
  provider: process.env.BILLING_PROVIDER || 'stripe',
  enabled: process.env.BILLING_ENABLED === 'true',
  plans: {
    creator: { name: 'Creador', priceCents: 499, credits: 30 },
    pro: { name: 'Pro', priceCents: 1499, credits: 100 }
  }
});

export function billingIsConfigured() {
  return BILLING_CONFIG.enabled && Boolean(process.env.STRIPE_SECRET_KEY);
}
