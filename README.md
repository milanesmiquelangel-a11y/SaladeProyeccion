# Sala de Proyección

International AI video studio for preparing, generating and organizing short AI video productions.

## Current video engine

The canonical video engine is **Wan 2.1 I2V Fast** through the Hugging Face Space:

- Space: `multimodalart/wan2-1-fast`
- Endpoint: `/generate_video`
- Runtime authentication: `HF_TOKEN`
- Mode: image-to-video
- The current Wan Fast workflow generates a short clip from a reference image; the application keeps the final clip at 5 seconds.

The repository no longer uses Pixazo as the active generation provider. Legacy Pixazo text/sequence handlers remain only inside the old server implementation for compatibility and are blocked by the Wan bootstrap entrypoint.

## Audio

The image-to-video workflow can optionally generate narration and mux it into the final MP4. The requested narration language is passed through the server and is not tied to the video engine language.

## Application

The web interface includes:

- Responsive video-production UI.
- Project drafts and local history.
- Prompt templates.
- Reference-image upload.
- Wan 2.1 I2V Fast generation.
- Optional narration and audio/video muxing.
- Billing and credit reservation through PostgreSQL.
- Render deployment configuration.

## Configuration

Set these Render environment variables:

- `HF_TOKEN` — Hugging Face token with access to the ZeroGPU Space.
- `WAN_FREE_SPACE` — defaults to `multimodalart/wan2-1-fast`.
- `WAN_FREE_ENDPOINT` — defaults to `/generate_video`.
- `DATABASE_URL` — PostgreSQL connection used by the billing system.

Never commit secret tokens to GitHub.

## Deployment

Render uses:

```text
npm install
npm start
```

The application starts through `src/wan-mode-entry.js`, which activates the Wan-only source guard before loading the existing application entrypoint.

Health endpoint:

```text
GET /api/health
```

The health response identifies the active provider as **Wan2.1 I2V Fast** and reports whether Hugging Face and PostgreSQL are configured.
