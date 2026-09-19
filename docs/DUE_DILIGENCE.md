# Buyer Due Diligence Checklist

This checklist is intended to make a technical review of Sala de Proyección straightforward.

## Product

- [ ] Review the main studio interface.
- [ ] Review the Phase 1 Prompt → Video workflow.
- [ ] Review supported formats, duration, quality and FPS controls.
- [ ] Review narration/language workflow.
- [ ] Review projects, drafts, history and templates.

## Backend

- [ ] Review `src/server.js` and the active Kling application bootstrap flow.
- [ ] Review provider integration and environment-variable configuration.
- [ ] Review FFmpeg normalization/assembly workflow.
- [ ] Review `/api/health` deployment health endpoint.

## Credits and billing

- [ ] Review PostgreSQL account and credit ledger.
- [ ] Review generation reservation/finalization/refund flow.
- [ ] Review Stripe Checkout/webhook integration points.
- [ ] Configure buyer-owned Stripe credentials and Price IDs before production use.

## Deployment

- [ ] Review `render.yaml`.
- [ ] Create buyer-owned deployment environment.
- [ ] Create buyer-owned PostgreSQL database.
- [ ] Add provider credentials as deployment secrets.
- [ ] Add administrator password as a deployment secret.
- [ ] Verify health endpoint after deployment.

## Security and ownership

- [ ] Confirm no secrets are committed to the repository.
- [ ] Rotate or replace any credentials used during development before handoff.
- [ ] Transfer only the assets explicitly included in the purchase agreement.
- [ ] Keep third-party provider accounts, domains and payment credentials separate unless their transfer is explicitly agreed.

## AI provider review

The application is provider-oriented rather than tied to a guarantee of one external service. Before commercial launch, the buyer should independently verify the selected provider's current API availability, quotas, pricing, licensing and terms.

The active prompt-to-video path is Kling VIDEO 3.0. Obsolete WAN generation entrypoints have been removed from the production tree.

## Handoff acceptance

- [ ] Buyer can install dependencies and start the application.
- [ ] Buyer can configure environment variables.
- [ ] Buyer can connect a PostgreSQL database.
- [ ] Buyer can verify the health endpoint.
- [ ] Buyer can perform a test generation using buyer-owned provider credentials.
- [ ] Buyer receives the agreed source code, documentation and any separately agreed assets.
