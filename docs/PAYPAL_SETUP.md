# PayPal Sandbox setup

## 1. Render environment variables

Add these variables to the Render service. Never commit the secret to GitHub.

```text
PAYPAL_CLIENT_ID=<Sandbox Client ID>
PAYPAL_CLIENT_SECRET=<Sandbox Client Secret>
PAYPAL_MODE=sandbox
BILLING_PROVIDER=paypal
PUBLIC_APP_URL=https://sala-de-proyeccion.onrender.com
BILLING_CURRENCY=EUR
```

## 2. Create the PayPal product and plans

From the Render Shell, run:

```bash
npm run paypal:setup
```

The command creates or reuses:

- Product: Sala de Proyección AI
- Sala Creator: 4.99 EUR/month → 30 credits
- Sala Pro: 14.99 EUR/month → 100 credits

Copy the three IDs printed by the command into Render:

```text
PAYPAL_PRODUCT_ID=...
PAYPAL_CREATOR_PLAN_ID=...
PAYPAL_PRO_PLAN_ID=...
```

## 3. PayPal webhook

After the application is deployed, create a webhook for the REST app with this URL:

```text
https://sala-de-proyeccion.onrender.com/api/billing/webhook
```

Subscribe at least to:

- `PAYMENT.SALE.COMPLETED`
- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.UPDATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.EXPIRED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.PAYMENT.FAILED`

Copy the generated Webhook ID into Render:

```text
PAYPAL_WEBHOOK_ID=...
```

## 4. Sandbox test

Use the PayPal Sandbox Personal account as the buyer and the Sandbox Business account as the merchant. Approve a subscription, then verify that PayPal sends the webhook and the account receives the plan credits.

Do not switch `PAYPAL_MODE` to `live` until the complete Sandbox flow works.
