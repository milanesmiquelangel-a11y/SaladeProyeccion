# Sala de Proyección

International AI video studio for preparing, generating and organizing short AI video productions.

## Generation architecture

The application has two independent generation paths:

### 1. Prompt → video

The user can write the scene they want without uploading a photograph. The application sends the user's prompt to the free Pixazo LTX video endpoint, preserves the requested subject/action/setting, and generates the selected duration in 5-second segments when necessary. The final segments are normalized and assembled into one MP4.

For longer productions, the same user prompt remains authoritative across every segment. Legacy automotive scene instructions are not used by the final sequence handler.

### 2. Photo → talking video

With a reference photograph and narration text, the application generates the requested voice and uses the voice as the driving audio for the Free.ai talking-head service. This produces mouth movement, facial expression, blinking and small head motion rather than simply placing unrelated voice-over on a static image.

Without narration, the photograph path remains available for visual animation through the existing LTX-based image-video workflow.

## Audio

The audio panel accepts narration text and a selected language. For photo + narration, the voice drives the talking-head animation. For prompt + narration without a photograph, the generated narration is added to the final video MP4. Audio is generated independently from the visual prompt, so changing the narration does not require changing the visual prompt.

## Application

The web interface includes:

- Responsive video-production UI.
- Project drafts and local history.
- Prompt templates.
- Optional reference-image upload.
- 5, 10, 15, 20, 25, 30 and 60 second prompt-to-video durations.
- Photo-based talking-head generation.
- Multilingual narration.
- Free prompt-to-video generation through Pixazo LTX.
- Audio muxing into prompt-generated videos.
- Billing and credit reservation through PostgreSQL.
- Render deployment configuration.
- Credit refund on generation failure/cancellation.

## Important engine policy

Wan 2.1 and Wan 2.2 are not used. Hugging Face ZeroGPU is not required for the prompt-to-video path. The talking-head path uses Free.ai rather than the previous ZeroGPU SadTalker route.

The repository deliberately does not claim that the video model can guarantee semantic perfection: the free LTX model is still responsible for the final visual interpretation. The application now sends the user's scene as the authoritative instruction and removes the old hard-coded automotive scene system from the active long-video generation path.

## Configuration

Set these Render environment variables:

- `PIXAZO_API_KEY` — key for the free Pixazo video endpoint.
- `PIXAZO_VIDEO_URL` — optional; defaults to the free LTX text-to-video endpoint.
- `FREEAI_API_KEY` — key for the Free.ai talking-head endpoint.
- `FREEAI_TALKING_HEAD_ENDPOINT` — optional; defaults to `https://api.free.ai/v1/video/talking-head/`.
- `DATABASE_URL` — PostgreSQL connection used by billing.

Never commit secret tokens to GitHub.

## Deployment

Render uses:

```text
npm install
npm start
```

The application starts through `src/wan-mode-entry.js`, which loads the generation guards and then the monetized application entrypoint.

Health endpoint:

```text
GET /api/health
```

Before launch, verify that the Render service has the required environment variables and that the health endpoint reports the generation and billing services as ready.
