import 'dotenv/config';
import express from 'express';
import { checkDatabase } from './database.js';

const originalGet = express.application.get;
const originalPost = express.application.post;

const WAN_SPACE = process.env.WAN_FREE_SPACE || 'multimodalart/wan2-1-fast';
const WAN_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/generate_video';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

// Canonical video engine for Sala de Proyección:
// Wan 2.1 I2V Fast through the Hugging Face Space.
// Legacy Pixazo text/sequence routes remain in server.js only for compatibility,
// but this bootstrap prevents them from being used accidentally.

express.application.get = function wanModeGet(route, ...handlers) {
  if (route === '/api/health') {
    return originalGet.call(this, route, async (_req, res) => {
      const database = await checkDatabase();
      const wanConfigured = Boolean(HF_TOKEN);
      const ready = wanConfigured && database.connected;
      return res.status(ready ? 200 : 503).json({
        ok: ready,
        service: 'sala-de-proyeccion-api',
        provider: 'Wan2.1 I2V Fast',
        providerSpace: WAN_SPACE,
        providerEndpoint: WAN_ENDPOINT,
        generationMode: 'image-to-video',
        generationReady: ready,
        wanConfigured,
        huggingFaceConfigured: wanConfigured,
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

express.application.post = function wanModePost(route, ...handlers) {
  if (route === '/api/video/generate' || route === '/api/video/sequence') {
    return originalPost.call(this, route, (_req, res) => res.status(410).json({
      error: 'El motor de vídeo activo es Wan 2.1 I2V Fast. La ruta antigua de texto/escenas fue desactivada. Usa Generar vídeo desde fotografía.',
      provider: 'Wan2.1 I2V Fast',
      providerSpace: WAN_SPACE,
      generationMode: 'image-to-video'
    }));
  }
  return originalPost.call(this, route, ...handlers);
};
