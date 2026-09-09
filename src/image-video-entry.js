import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const PIXAZO_IMAGE_VIDEO_URL = 'https://gateway.pixazo.ai/ltx-video/v1/image-to-video';
const PIXAZO_STATUS_URL = 'https://gateway.pixazo.ai/v2/requests/status';
const IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const imageJobs = new Map();

const nativeListen = express.application.listen;

function imageDimensions(aspect, quality) {
  const size = quality === 'high' ? 1024 : 768;
  const short = Math.round((size * 9) / 16 / 32) * 32;
  if (aspect === '9:16') return [short, size];
  if (aspect === '1:1') return [size, size];
  return [size, short];
}

function absolutePublicUrl(req, relativePath) {
  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwarded || req.protocol || 'https';
  return new URL(relativePath, `${protocol}://${req.get('host')}`).toString();
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

async function uploadImage(req, res) {
  const contentType = String(req.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    return res.status(415).json({ error: 'La fotografía debe ser JPG, PNG o WEBP.' });
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No se recibió ninguna fotografía.' });
  if (req.body.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'La fotografía no puede superar 20 MB.' });
  await fs.mkdir(uploadsDir, { recursive: true });
  const filename = `${randomUUID()}.${extensionFor(contentType)}`;
  await fs.writeFile(path.join(uploadsDir, filename), req.body);
  return res.status(201).json({ url: `/uploads/${filename}` });
}

async function removeTemporaryUpload(imageUrl) {
  const relative = String(imageUrl || '');
  if (!relative.startsWith('/uploads/')) return;
  const filename = path.basename(relative.slice('/uploads/'.length));
  if (!filename || filename === '.' || filename === '..') return;
  await fs.rm(path.join(uploadsDir, filename), { force: true });
}

async function submitImageVideo(req, body) {
  const imageUrl = absolutePublicUrl(req, body.imageUrl);
  const [width, height] = imageDimensions(body.aspect, body.resolution);

  // Keep the instruction deliberately motion-only. Describing facial features
  // again can encourage the model to reinterpret the source instead of
  // animating it. The uploaded photograph is the sole visual identity source.
  const motion = String(body.prompt || '').trim();
  const motionPrompt = [
    'ANIMATE THE SUPPLIED PHOTOGRAPH ONLY.',
    'The uploaded photograph is the exact source image and identity reference.',
    'Do not create, redraw, regenerate, replace or reinterpret the person.',
    'Preserve the exact face, appearance, clothing, hairstyle, proportions and visual identity from the source image.',
    'Keep the person visually identical to the source image for the entire clip.',
    motion || 'Only add extremely subtle natural breathing and a very small natural head movement.',
    'Use a locked or nearly locked camera. Make only subtle realistic motion.',
    'Do not introduce new objects, people or scene changes.',
    'Photorealistic image animation, natural motion, stable composition, no identity drift.'
  ].filter(Boolean).join(' ');

  const negative = [
    'different person',
    'new person',
    'different face',
    'face replacement',
    'face regeneration',
    'face reinterpretation',
    'identity change',
    'identity drift',
    'facial morphing',
    'facial redesign',
    'changed facial features',
    'changed eye color',
    'changed hair color',
    'changed hairstyle',
    'age change',
    'different body proportions',
    'different clothing',
    'different background',
    'new background',
    'duplicate person',
    'extra face',
    'extra limbs',
    'distorted face',
    'warped face',
    'deformed face',
    'warped hands',
    'camera zoom',
    'camera rotation',
    'scene change',
    'cartoon',
    'CGI'
  ].join(', ');

  const payload = {
    prompt: motionPrompt.slice(0, 4000),
    image_url: imageUrl,
    strength: 1.0,
    negative,
    aspect: ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9',
    width,
    height,
    num_frames: 121,
    frame_rate: 24,
    enhance_prompt: false
  };
  const response = await fetch(PIXAZO_IMAGE_VIDEO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail;
    throw new Error(message ? `Pixazo rechazó la fotografía: ${message}` : `Pixazo rechazó la fotografía (HTTP ${response.status}).`);
  }
  const requestId = data.request_id || data.requestId;
  if (!requestId) throw new Error('Pixazo no devolvió un identificador de generación.');
  return requestId;
}

async function runImageJob(job) {
  const deadline = Date.now() + IMAGE_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (job.status === 'CANCELLED') return;
      const response = await fetch(`${PIXAZO_STATUS_URL}/${encodeURIComponent(job.requestId)}`, {
        headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || `Pixazo no pudo consultar el estado (HTTP ${response.status}).`);
      const state = String(data.status || data.state || '').toUpperCase();
      job.providerState = state;
      if (job.status === 'CANCELLED') return;
      if (state === 'COMPLETED' || state === 'SUCCEEDED' || data.output?.media_url) {
        const rawUrl = data.output?.media_url;
        job.outputUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
        if (!job.outputUrl) throw new Error('Pixazo terminó sin devolver un vídeo.');
        if (job.status === 'CANCELLED') return;
        if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
        job.status = 'COMPLETED';
        return;
      }
      if (['ERROR', 'FAILED', 'CANCELLED'].includes(state)) throw new Error(data.error || `La generación terminó con estado ${state}.`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error('La generación superó el límite de 20 minutos.');
  } catch (error) {
    if (job.status === 'CANCELLED') return;
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'image_generation_failed');
    job.status = 'ERROR';
    job.detail = `${error.message || 'No se pudo generar el vídeo desde la fotografía.'} El crédito fue devuelto.`;
  }
}

function mountImageRoutes(app) {
  if (app._salaImageVideoMounted) return;
  app.post('/api/media/image', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '20mb' }), uploadImage);
  app.post('/api/video/image-to-video', async (req, res) => {
    if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
    const body = req.body || {};
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
    if (!body.imageUrl || !String(body.imageUrl).startsWith('/uploads/')) return res.status(400).json({ error: 'Selecciona una fotografía antes de generar.' });
    try {
      const requestId = await submitImageVideo(req, body);
      try {
        await removeTemporaryUpload(body.imageUrl);
      } catch (cleanupError) {
        console.warn('No se pudo eliminar la fotografía temporal después de enviarla a Pixazo:', cleanupError?.message || cleanupError);
      }
      const jobId = randomUUID();
      const job = { id: jobId, requestId, status: 'PROCESSING', providerState: 'QUEUED', createdAt: Date.now(), outputUrl: '', detail: 'Enviando la fotografía al motor de vídeo…', userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId };
      imageJobs.set(jobId, job);
      runImageJob(job).catch((error) => { job.status = 'ERROR'; job.detail = error.message || 'No se pudo completar la generación.'; });
      return res.status(202).json({ job_id: jobId, request_id: requestId });
    } catch (error) {
      try {
        await removeTemporaryUpload(body.imageUrl);
      } catch (cleanupError) {
        console.warn('No se pudo eliminar la fotografía temporal tras un envío fallido:', cleanupError?.message || cleanupError);
      }
      if (req.salaBillingUserId && req.salaBillingTransactionId) await refundGeneration(req.salaBillingUserId, req.salaBillingTransactionId, 'image_generation_submit_failed');
      return res.status(502).json({ error: error.message || 'No se pudo iniciar la generación desde la fotografía.' });
    }
  });
  app.get('/api/video/image-to-video/:jobId', (req, res) => {
    const job = imageJobs.get(String(req.params.jobId || ''));
    if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
    return res.json({ id: job.id, status: job.status, providerState: job.providerState, detail: job.detail || '', outputUrl: job.outputUrl || '' });
  });
  app.post('/api/video/image-to-video/:jobId/cancel', async (req, res) => {
    const job = imageJobs.get(String(req.params.jobId || ''));
    if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
    if (job.status === 'PROCESSING') {
      job.status = 'CANCELLED';
      if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'image_generation_cancelled');
    }
    return res.json({ ok: true, status: job.status, creditRefunded: true });
  });
  app._salaImageVideoMounted = true;
}

express.application.listen = function imageVideoListen(...args) {
  const app = this;
  mountImageRoutes(app);
  return nativeListen.apply(app, args);
};
