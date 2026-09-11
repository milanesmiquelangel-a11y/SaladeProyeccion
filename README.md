# Sala de Proyección

International AI video studio for preparing, generating and organizing short AI video productions.

## Current video engine

The canonical narrated photo-video engine is **SadTalker** through the Hugging Face ZeroGPU Space:

- Space: `henrybit/SadTalker-Demo`
- Endpoint: `/generate`
- Runtime authentication: `HF_TOKEN`
- Mode: image-to-talking-head
- Input: one reference photograph plus generated driving audio
- Final narrated clip: 5 seconds

SadTalker is used when narration text is supplied. The generated voice drives the mouth, facial expressions, blinking and small head movements instead of being placed on top of a static video as unrelated voice-over. Without narration, the application falls back to the existing LTX 2.3 visual-only image-to-video workflow.

The repository no longer uses Wan 2.1 as the active generation engine. Legacy Pixazo text/sequence handlers remain only inside the old server implementation for compatibility and are not selected by the active image-to-video route.

## Audio

The image-to-video workflow can generate narration in the selected language. When narration is present, that audio is sent directly to SadTalker as the animation driver, keeping speech and facial movement in the same generation step.

## Application

The web interface includes:

- Responsive video-production UI.
- Project drafts and local history.
- Prompt templates.
- Reference-image upload.
- 5-second talking-head generation from a photograph.
- Optional multilingual narration and lip-sync animation.
- LTX 2.3 visual-only fallback when narration is empty.
- Billing and credit reservation through PostgreSQL.
- Render deployment configuration.

## Configuration

Set these Render environment variables:

- `HF_TOKEN` — Hugging Face token with access to the ZeroGPU Space.
- `SADTALKER_FREE_SPACE` — defaults to `henrybit/SadTalker-Demo`.
- `SADTALKER_FREE_ENDPOINT` — defaults to `/generate`.
- `DATABASE_URL` — PostgreSQL connection used by the billing system.

Never commit secret tokens to GitHub.

## Deployment

Render uses:

```text
npm install
npm start
```

The application starts through `src/wan-mode-entry.js`, which activates the source guard before loading the existing application entrypoint.

Health endpoint:

```text
GET /api/health
```

The health response identifies the active provider as **SadTalker** and reports whether Hugging Face and PostgreSQL are configured.
