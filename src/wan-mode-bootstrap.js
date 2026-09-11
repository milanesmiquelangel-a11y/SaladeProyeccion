import 'dotenv/config';
import express from 'express';
import { checkDatabase } from './database.js';

const originalGet = express.application.get;
const originalPost = express.application.post;

const SADTALKER_SPACE = process.env.SADTALKER_FREE_SPACE || 'henrybit/SadTalker-Demo';
const SADTALKER_ENDPOINT = process.env.SADTALKER_FREE_ENDPOINT || '/generate';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

// Canonical narrated photo-video engine for Sala de Proyección:
// SadTalker uses the generated voice audio to animate the face, mouth,
// expressions, blinking and small head movements from one photograph.

express.application.get = function sadTalkerModeGet(route, ...handlers) {
  if (route === '/api/health') {
    return originalGet.call(this, route, async (_req, res) => {
      const database = await checkDatabase();
      const sadTalkerConfigured = Boolean(HF_TOKEN);
      const ready = sadTalkerConfigured && database.connected;
      return res.status(ready ? 200 : 503).json({
        ok: ready,
        service: 'sala-de-proyeccion-api',
        provider: 'SadTalker',
        providerSpace: SADTALKER_SPACE,
        providerEndpoint: SADTALKER_ENDPOINT,
        generationMode: 'image-to-talking-head',
        generationReady: ready,
        sadTalkerConfigured,
        huggingFaceConfigured: sadTalkerConfigured,
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

express.application.post = function sadTalkerModePost(route, ...handlers) {
  if (route === '/api/video/generate' || route === '/api/video/sequence') {
    return originalPost.call(this, route, (_req, res) => res.status(410).json({
      error: 'El motor de vídeo activo es SadTalker para vídeos hablados desde fotografía. Usa Generar vídeo desde fotografía.',
      provider: 'SadTalker',
      providerSpace: SADTALKER_SPACE,
      generationMode: 'image-to-talking-head'
    }));
  }
  return originalPost.call(this, route, ...handlers);
};