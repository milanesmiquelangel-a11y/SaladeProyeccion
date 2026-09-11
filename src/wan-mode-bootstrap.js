import 'dotenv/config';
import express from 'express';
import { checkDatabase } from './database.js';

const originalGet = express.application.get;
const originalPost = express.application.post;

const LTX_SPACE = process.env.LTX_FREE_SPACE || 'Lightricks/LTX-2-3';
const LTX_ENDPOINT = process.env.LTX_FREE_ENDPOINT || '/generate_video';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

// Canonical video engine for Sala de Proyección:
// LTX 2.3 Distilled through the official Lightricks Hugging Face Space.
// Legacy Pixazo text/sequence routes remain in server.js only for compatibility,
// but this bootstrap prevents them from being used accidentally.

express.application.get = function ltxModeGet(route, ...handlers) {
  if (route === '/api/health') {
    return originalGet.call(this, route, async (_req, res) => {
      const database = await checkDatabase();
      const ltxConfigured = Boolean(HF_TOKEN);
      const ready = ltxConfigured && database.connected;
      return res.status(ready ? 200 : 503).json({
        ok: ready,
        service: 'sala-de-proyeccion-api',
        provider: 'LTX 2.3 Distilled',
        providerSpace: LTX_SPACE,
        providerEndpoint: LTX_ENDPOINT,
        generationMode: 'image-to-video',
        generationReady: ready,
        ltxConfigured,
        huggingFaceConfigured: ltxConfigured,
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

express.application.post = function ltxModePost(route, ...handlers) {
  if (route === '/api/video/generate' || route === '/api/video/sequence') {
    return originalPost.call(this, route, (_req, res) => res.status(410).json({
      error: 'El motor de vídeo activo es LTX 2.3 Distilled. La ruta antigua de texto/escenas fue desactivada. Usa Generar vídeo desde fotografía.',
      provider: 'LTX 2.3 Distilled',
      providerSpace: LTX_SPACE,
      generationMode: 'image-to-video'
    }));
  }
  return originalPost.call(this, route, ...handlers);
};