# Sala de Proyección — Buyer Handoff

## Product

Sala de Proyección is a web-based AI video studio for preparing, generating and organizing short AI video productions.

The current launch scope is **prompt-to-video**. The interface also contains the existing audio/narration and project-management foundations. Image-to-video is intentionally deferred from the primary launch flow until its dedicated engine is validated.

## What the buyer receives

- Full application source code in this repository.
- Node.js / Express backend.
- Browser-based production interface.
- Prompt-to-video generation path.
- Video normalization and assembly with FFmpeg.
- Optional multilingual narration/audio generation.
- Project drafts and local history.
- Credit reservation, completion and refund ledger backed by PostgreSQL.
- Billing configuration and Stripe checkout/webhook integration points.
- Administrator configuration and health endpoint.
- Render deployment configuration.
- SEO metadata, sitemap/robots configuration and application metadata.

## Current technical stack

- Node.js 18+
- Express 4
- PostgreSQL (`pg`)
- FFmpeg via `ffmpeg-static`
- Stripe-compatible billing flow
- Render deployment configuration

See `package.json` for the current dependency list.

## Deployment

The intended deployment is a Node web service. The repository's Render configuration runs:

```text
npm install
npm start
```

Health endpoint:

```text
GET /api/health
```

Required production configuration includes the selected video-provider credentials, PostgreSQL connection, administrator secret, and billing secrets when payments are enabled.

## Billing

The billing architecture is already present but must be configured with the buyer's own Stripe account and Price IDs before accepting real payments. The current code supports one-time Checkout payments and credits the user's account only after a valid signed Stripe webhook event.

Current application plan configuration is in `src/billing-config.js` and currently defines:

- Creator: EUR 4.99 / 30 credits
- Pro: EUR 14.99 / 100 credits

These are product configuration values, not a claim about the final commercial pricing. A buyer can change them before launch.

## Video provider

The application keeps the video provider behind environment configuration so the buyer can replace the provider without redesigning the product. The current deployment configuration references the existing Pixazo/LTX path. Provider availability, pricing, quotas and commercial terms must be independently verified by the buyer before production use.

The repository does **not** contain provider secret keys. Secrets must be supplied through deployment environment variables.

## Important production checklist

Before a buyer launches commercially:

1. Create the buyer's production deployment.
2. Configure PostgreSQL and run the application's database initialization/migrations as required by the current code.
3. Configure the buyer's video-provider credentials and confirm current provider terms.
4. Configure Stripe secret key, webhook secret and Price IDs.
5. Create the Stripe webhook endpoint pointing to `/api/billing/webhook` (subject to the route mounted by the current server entrypoint).
6. Test checkout and webhook crediting in Stripe test mode.
7. Test generation failure/refund behavior.
8. Set a production administrator password.
9. Verify `/api/health` before launch.
10. Replace deployment/domain metadata with the buyer's own brand and domain if the brand is included in the transaction.

## Commercial positioning

The product should be presented as a **ready-to-customize AI video studio**, not as a guaranteed AI model itself. The visual result remains dependent on the selected video provider/model.

Recommended sale positioning:

> Ready-to-customize AI video studio with generation, projects, credits, billing architecture, narration and deployment foundation.

## Intellectual-property handoff

The repository currently does not grant a third party an open-source license. A commercial sale should therefore be accompanied by a written agreement that specifies exactly what is transferred:

- source-code ownership or license rights;
- brand/domain rights, if included;
- commercial use rights;
- third-party dependency/provider obligations;
- whether future support is included;
- whether the seller retains any rights to reuse generic components.

This document is a technical handoff checklist, not a legal contract.
