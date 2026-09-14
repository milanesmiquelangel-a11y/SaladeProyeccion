# Sala de Proyección

**International AI video studio for preparing, generating and organizing short AI video productions.**

## Product overview

Sala de Proyección is a web application that turns a user's scene description into an AI-generated video, with optional multilingual narration, project organization, credit accounting and administrator controls.

The current launch strategy is **Phase 1: Prompt → Video**. Image-to-video is intentionally deferred until a dedicated production-ready engine is selected and validated.

## Current capabilities

- Responsive video-production interface.
- Prompt-to-video generation.
- Configurable 16:9, 9:16 and 1:1 formats.
- Configurable video duration.
- Standard/high quality options and 24/30 FPS.
- Optional multilingual narration.
- FFmpeg video normalization and assembly.
- Project drafts and local history.
- Prompt templates.
- PostgreSQL-backed credit accounting.
- Credit reservation, finalization and refund on failed/cancelled generation.
- Stripe Checkout/webhook integration points.
- Administrator configuration.
- Render deployment configuration.
- Health endpoint for deployment verification.

## Commercial architecture

The application keeps provider credentials on the server. The video-generation layer is configurable through environment variables so the owner can replace the underlying provider/model without redesigning the product interface.

Billing is credit-based. Current configured plans are Creator and Pro; production payment activation requires the operator's own Stripe credentials and Price IDs.

## Deployment

Render uses:

```text
npm install
npm start
```

The application starts through `src/wan-mode-entry.js`.

Health endpoint:

```text
GET /api/health
```

Required production configuration includes a PostgreSQL `DATABASE_URL`, video-provider credentials, and (when payments are enabled) Stripe secret/webhook/Price ID values.

## Buyer handoff

A commercial handoff should use fresh credentials owned by the buyer. Third-party API accounts, domains, payment accounts and paid provider credits are not included unless explicitly agreed in writing.

See:

- `docs/PRODUCT_STATUS.md` — product readiness and known limitations.
- `docs/BUYER_HANDOFF.md` — technical handoff information.
- `docs/SALES_LISTING.md` — commercial sales draft and asking-price strategy.

## Important engine policy

Wan 2.1 and Wan 2.2 are not used. Hugging Face ZeroGPU is not required for the prompt-to-video path.

The repository does not guarantee semantic perfection from the AI video model. The configured model remains responsible for the final visual interpretation.

## Security

Never commit API keys, payment secrets, database credentials or administrator passwords to GitHub. Production credentials belong only in the deployment environment.
