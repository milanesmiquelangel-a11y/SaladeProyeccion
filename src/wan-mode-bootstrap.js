import 'dotenv/config';
import express from 'express';
import { checkDatabase } from './database.js';

const originalGet = express.application.get;
const originalPost = express.application.post;

const FREEAI_ENDPOINT = process.env.FREEAI_TALKING_HEAD_ENDPOINT || 'https://api.free.ai/v1/video/talking-head/';
const FREEAI_API_KEY = String(process.env.FREEAI_API_KEY || '').trim();

// Canonical narrated photo-video engine for Sala de Proyección:
// Free.ai Talking Head receives the photograph plus generated voice audio.
// It does not use Hugging Face ZeroGPU.

express.application.get = function freeAiModeGet(route, ...handlers) {
  if (route === '/api/health') {
    return originalGet.call(this, route, async (_req, res) => {
      const database = await checkDatabase();
      const freeAiConfigured = Boolean(FREEAI_API_KEY);
      const ready = freeAiConfigured && database.connected;
      return res.status(ready ? 200 : 503).json({
        ok: ready,
        service: 'sala-de-proyeccion-api',
        provider: 'Free.ai',
        providerEndpoint: FREEAI_ENDPOINT,
        generationMode: 'image-to-talking-head',
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

express.application.post = function freeAiModePost(route, ...handlers) {
  if (route === '/api/video/generate' || route === '/api/video/sequence') {
    return originalPost.call(this, route, (_req, res) => res.status(410).json({
      error: 'El motor de vídeo hablado desde fotografía es Free.ai. Usa Generar vídeo desde fotografía.',
      provider: 'Free.ai',
      providerEndpoint: FREEAI_ENDPOINT,
      generationMode: 'image-to-talking-head'
    }));
  }
  return originalPost.call(this, route, ...handlers);
};
