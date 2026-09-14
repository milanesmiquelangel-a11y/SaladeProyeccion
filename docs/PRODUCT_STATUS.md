# Sala de Proyección — Product Readiness

**Purpose:** buyer-facing snapshot of the current product state.

## Current product

Sala de Proyección is an international web-based AI video studio focused on prompt-to-video production. The current launch phase intentionally prioritizes prompt-to-video reliability and keeps image-to-video for a later phase.

## Implemented product areas

- Responsive web production interface.
- Prompt-based video generation workflow.
- Configurable aspect ratio, duration, quality and FPS.
- Optional multilingual narration.
- FFmpeg normalization and video assembly.
- Project drafts and local history.
- Prompt templates.
- PostgreSQL-backed credit accounting.
- Credit reservation, completion and refund handling.
- Stripe checkout/webhook integration points.
- Administrator configuration.
- Render deployment configuration.
- Health endpoint for deployment checks.
- Provider-oriented environment configuration so the generation backend can be replaced without redesigning the product UI.

## Commercial architecture

The application is designed so that the owner/operator controls provider credentials on the server rather than exposing them in the browser. A buyer can deploy the application with their own infrastructure and provider accounts.

Billing currently defines Creator and Pro plans and is designed around credits rather than exposing provider costs directly to users.

## Current limitations to disclose to a buyer

- The current production generation path depends on the configured video provider and its availability/limits.
- AI video generation quality is model-dependent and is not guaranteed to execute every requested action perfectly.
- Image-to-video is intentionally deferred from the Phase 1 launch experience.
- Production payment activation requires the buyer/operator to configure Stripe credentials, Price IDs and webhook secrets.
- Production deployment requires the buyer/operator to configure the database and generation-provider credentials.

## Recommended buyer handoff

1. Transfer repository ownership or provide the agreed source-code package.
2. Transfer or reconfigure the production deployment.
3. Create fresh provider credentials owned by the buyer.
4. Configure PostgreSQL and billing credentials.
5. Verify `/api/health` and a complete generation/refund cycle.
6. Change all administrative secrets to buyer-owned values.
7. Provide the buyer with the deployment and environment-variable documentation.

## Important commercial note

No third-party API key, secret token, payment credential or personal account credential is part of the sale unless explicitly agreed in writing. The buyer should use accounts they control.
