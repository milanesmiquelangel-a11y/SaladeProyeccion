# Sala de Proyección

**International AI video studio using one explicit production engine: Kling VIDEO 3.0.**

## Active production path
```
User prompt
   ↓
Kling VIDEO 3.0
   ↓
Native Audio (when dialogue is requested)
   ↓
FFmpeg validation / final MP4
```

There is no active WAN, Pixazo, LTX or post-generated TTS fallback in the production entrypoint. A requested native-dialogue generation is considered failed if Kling does not return an audio stream.

## Native dialogue

Kling VIDEO 3.0 generates visuals, dialogue, lip movement, ambience and sound together. Kling's current official native-dialogue documentation lists Chinese, English, Japanese, Korean and Spanish; unsupported languages must not be silently translated or replaced by a separate TTS track. [Kling VIDEO 3.0 guide](https://kling.ai/quickstart/klingai-video-3-model-user-guide)

For languages outside those five, the project can later add a dedicated lip-sync workflow, but that is a different pipeline and must be explicitly identified as such.

## Generation limits

- Single-shot duration: 3–15 seconds.
- Standard mode: 720p-class generation.
- Pro mode: higher-quality generation.
- Output aspect ratios: 16:9, 9:16 and 1:1.
- Native audio is enabled only when dialogue is requested.
- FFmpeg checks the final MP4 for the expected audio stream before the job is marked complete.

Kling public API references corroborate the /v1/videos/text2video task/poll pattern and the sound on/off parameter for Kling v3.

## Authentication

Render must contain:
```
KLING_ACCESS_KEY
KLING_SECRET_KEY
KLING_API_BASE_URL=https://api.klingai.com
KLING_MODEL=kling-v3
```

The server creates the short-lived HS256 JWT from the access/secret pair. Do not commit credentials to GitHub.

## Deployment

Render runs:
```
npm install
npm start
```
and npm start now launches src/server.js directly. The previous src/wan-mode-entry.js startup path was still active in package.json, which is why the deployed application could report WAN 2.2 even after the Kling server code had been added.

## Health

`GET /api/health` identifies the active provider and native-dialogue languages. If Kling credentials are missing, generation is reported as unavailable instead of silently falling back to another video engine.

## Validation

```
npm install
npm run check
```
The check validates only the active server and Kling provider.
