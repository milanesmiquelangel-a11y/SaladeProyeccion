import 'dotenv/config';
import express from 'express';
import { checkDatabase } from './database.js';

const originalGet = express.application.get;

const FREEAI_ENDPOINT = process.env.FREEAI_TALKING_HEAD_ENDPOINT || 'https://api.free.ai/v1/video/talking-head/';
const FREEAI_API_KEY = String(process.env.FREEAI_API_KEY || '').trim();

// Free.ai is the canonical engine for narrated photo -> talking-head videos.
// Text-only generation remains available through the normal Pixazo text-to-video route.
// Hugging Face ZeroGPU is not used for the narrated photo path.

express.application.get = function freeAiModeGet(route, ...handlers) {
  if (route === '/api/health') {
    return originalGet.call(this, route, async (_req, res) => {
      const database = await checkDatabase();
      const freeAiConfigured = Boolean(FREEAI_API_KEY);
      const ready = freeAiConfigured && database.connected;
      return res.status(ready ? 200 : 503).json({
        ok: ready,
        service: 'sala-de-proyeccion-api',
        provider: 'Free.ai + Pixazo',
        providerEndpoint: FREEAI_ENDPOINT,
        generationMode: 'photo-to-talking-head + text-to-video',
        generationReady: ready,
        freeAiConfigured,
        huggingFaceConfigured: false,
        billingPersistence: database.connected,
        billingDatabase: database.connected ? 'connected' : (database.configured ? 'error' : 'missing'),
        billingDatabaseError: database.connected ? null : database.error,
        sequenceAssembly: true,
        generationTimeoutSeconds: 20 * 60
      });
    });
  }
  return originalGet.call(this, route, ...handlers);
};
