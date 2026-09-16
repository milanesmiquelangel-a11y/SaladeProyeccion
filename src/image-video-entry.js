import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';
import { generateWanVideo } from './wan-video-provider.js';
import { generateSpeechAudio, muxAudioIntoVideo, normalizeAudioLanguage } from './audio-tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const generatedDir = path.join(publicDir, 'generated');
const audioDir = path.join(publicDir, 'generated-audio');
const imageJobs = new Map();
const nativeListen = express.application.listen;

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

async function uploadImage(req, res) {
  const contentType = String(req.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return res.status(415).json({ error: 'La fotografía debe ser JPG, PNG o WEBP.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No se recibió ninguna fotografía.' });
  if (req.body.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'La fotografía no puede superar 20 MB.' });
  await fs.mkdir(uploadsDir, { recursive: true });
  const filename = `${randomUUID()}.${extensionFor(contentType)}`;
  await fs.writeFile(path.join(uploadsDir, filename), req.body);
  return res.status(201).json({ url: `/uploads/${filename}` });
}

async function runImageJob(job) {
  let audioPath = '';
  const work = path.join(generatedDir, `.work-${job.id}`);
  try {
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.mkdir(work, { recursive: true });
    job.providerState = 'WAN_2_2';
    job.detail = 'Generando vídeo desde la fotografía con WAN 2.2…';
    const mediaUrl = await generateWanVideo({ prompt: job.prompt, aspect: job.aspect, imagePath: job.imagePath, job });
    const silentPath = path.join(work, 'silent.mp4');
    const response = await fetch(mediaUrl);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo WAN 2.2 (HTTP ${response.status}).`);
    await fs.writeFile(silentPath, Buffer.from(await response.arrayBuffer()));
    const finalPath = path.join(generatedDir, `${job.id}.mp4`);
    if (job.audioText) {
      job.providerState = 'GENERATING_AUDIO';
      job.detail = `Generando narración ${normalizeAudioLanguage(job.audioLanguage)}…`;
      audioPath = await generateSpeechAudio({ text: job.audioText, language: job.audioLanguage, outputDir: audioDir });
      await muxAudioIntoVideo({ videoPath: silentPath, audioPath, outputPath: finalPath, durationSeconds: job.duration });
    } else {
      await fs.copyFile(silentPath, finalPath);
    }
    if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
    job.outputUrl = `/generated/${job.id}.mp4`;
    job.status = 'COMPLETED';
    job.providerState = 'COMPLETED';
    job.detail = job.audioText ? `Vídeo desde fotografía con narración ${normalizeAudioLanguage(job.audioLanguage)}.` : 'Vídeo desde fotografía completado con WAN 2.2.';
  } catch (error) {
    console.error('[IMAGE VIDEO]', error?.stack || error);
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'image_generation_failed');
    job.status = 'ERROR';
    job.providerState = 'ERROR';
    job.detail = `${error.message || 'No se pudo generar el vídeo desde la fotografía.'} El crédito fue devuelto.`;
  } finally {
    if (audioPath) await fs.rm(audioPath, { force: true }).catch(() => {});
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    await fs.rm(job.imagePath, { force: true }).catch(() => {});
  }
}

function mountImageRoutes(app) {
  if (app._salaImageVideoMounted) return;
  app.post('/api/media/image', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '20mb' }), uploadImage);
  app.post('/api/video/image-to-video', async (req, res) => {
    const body = req.body || {};
    if (!body.imageUrl || !String(body.imageUrl).startsWith('/uploads/')) return res.status(400).json({ error: 'Selecciona una fotografía antes de generar.' });
    const relative = String(body.imageUrl).slice('/'.length);
    const imagePath = path.join(publicDir, relative);
    try {
      await fs.access(imagePath);
      const id = randomUUID();
      const job = {
        id, status: 'QUEUED', providerState: 'QUEUED', detail: 'Preparando fotografía…', outputUrl: '',
        createdAt: Date.now(), imagePath, prompt: String(body.prompt || 'Realistic natural movement of the subject, stable identity and environment.').slice(0, 4000),
        aspect: ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9', duration: Math.min(30, Math.max(5, Number(body.duration) || 5)),
        audioText: String(body.audioText || '').trim().slice(0, 4000), audioLanguage: normalizeAudioLanguage(body.audioLanguage || 'en'),
        userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId
      };
      imageJobs.set(id, job);
      runImageJob(job).catch((error) => { job.status = 'ERROR'; job.detail = error.message || 'No se pudo completar la generación.'; });
      return res.status(202).json({ job_id: id, provider: 'WAN 2.2 ZeroGPU', audio: Boolean(job.audioText) });
    } catch (error) {
      await fs.rm(imagePath, { force: true }).catch(() => {});
      if (req.salaBillingUserId && req.salaBillingTransactionId) await refundGeneration(req.salaBillingUserId, req.salaBillingTransactionId, 'image_generation_submit_failed');
      return res.status(502).json({ error: error.message || 'No se pudo iniciar la generación desde la fotografía.' });
    }
  });
  app.get('/api/video/image-to-video/:jobId', (req, res) => {
    const job = imageJobs.get(String(req.params.jobId || ''));
    if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
    return res.json({ id: job.id, status: job.status, providerState: job.providerState, detail: job.detail, outputUrl: job.outputUrl });
  });
  app.post('/api/video/image-to-video/:jobId/cancel', async (req, res) => {
    const job = imageJobs.get(String(req.params.jobId || ''));
    if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
    if (!['COMPLETED', 'ERROR', 'CANCELLED'].includes(job.status)) {
      job.status = 'CANCELLED';
      if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'image_generation_cancelled');
      await fs.rm(job.imagePath, { force: true }).catch(() => {});
    }
    return res.json({ ok: true, status: job.status, creditRefunded: true });
  });
  app._salaImageVideoMounted = true;
}

express.application.listen = function imageVideoListen(...args) {
  mountImageRoutes(this);
  return nativeListen.apply(this, args);
};
