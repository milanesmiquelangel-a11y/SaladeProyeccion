# Sala de Proyección

**International AI video studio for creating, organizing and finishing short AI video productions.**

## Current generation architecture

The production path is now intentionally simple:

```text
User prompt
   ↓
WAN 2.2 5B on a Hugging Face ZeroGPU Space
   ↓
FFmpeg normalization / multi-segment assembly
   ↓
Optional multilingual Edge TTS narration
   ↓
Final MP4
```

The application does **not** use Pixazo/LTX for the main generation path. Legacy provider patches were removed from the application entrypoint.

## Current capabilities

- Prompt-to-video with WAN 2.2 5B.
- Text-to-video and image-to-video through the same WAN provider adapter.
- Automatic Gradio API discovery instead of hard-coded endpoint positions.
- Fallback between compatible public WAN 2.2 Spaces when the primary Space is unavailable.
- 16:9, 9:16 and 1:1 output formats.
- 5–30 second UI durations, assembled from short WAN clips when necessary.
- Optional multilingual narration.
- Edge TTS first, with Google TTS as a fallback.
- English, Spanish, Russian and Kazakh voices plus additional supported languages.
- FFmpeg normalization, continuity assembly and audio muxing.
- Project drafts and browser-local history.
- PostgreSQL-backed credit accounting with reservation/finalization/refund handling.
- Administrator controls and Render deployment configuration.
- `/api/health` deployment health endpoint.

## Important provider note

The current free video engine depends on the availability and quotas of public Hugging Face Spaces. The selected primary Space is `Upsampler/wan-2-2-5b-video`; the backend can fall back to another compatible WAN 2.2 Space. This is a free/community compute path, not a guaranteed unlimited commercial API.

The application keeps provider credentials on the server. An optional `HF_TOKEN` can be supplied when a Space requires authentication or benefits from authenticated access.

## Audio

Narration is generated server-side and is inserted into the final MP4 before the job is marked `COMPLETED`. This is important: a successful video job with requested narration is not considered complete until the audio stream has been verified in the resulting MP4.

The default interface language is English, while voice generation is dynamically selectable and is not limited to the four primary project languages.

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

Production configuration should include PostgreSQL `DATABASE_URL` and the normal authentication/payment settings used by the application. `HF_TOKEN` is optional for the public WAN Spaces.

## Validation

GitHub Actions runs:

```text
npm install
npm run check
```

The check validates the active Node entrypoint, WAN provider, final generation pipeline and audio engine syntax.

## Security

Never commit API keys, payment secrets, database credentials or administrator passwords to GitHub. Production credentials belong only in the deployment environment.
