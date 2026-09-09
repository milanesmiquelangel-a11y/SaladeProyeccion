import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const generatedDir = path.join(publicDir, 'generated');
const imageJobs = new Map();

const nativeListen = express.application.listen;

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

function outputDimensions(aspect, quality) {
  const size = quality === 'high' ? 1024 : 768;
  if (aspect === '9:16') return [432, size];
  if (aspect === '1:1') return [size, size];
  return [size, 432];
}

async function renderIdentitySafeVideo(imagePath, outputPath, body) {
  if (!ffmpegPath) throw new Error('FFmpeg no está disponible en el servidor.');
  const duration = Math.max(1, Math.min(60, Number(body.duration) || 5));
  const fps = Number(body.frameRate) === 30 ? 30 : 24;
  const [width, height] = outputDimensions(body.aspect, body.resolution);
  const frames = Math.max(1, Math.round(duration * fps));

  // The photograph itself is never regenerated. FFmpeg only creates a video
  // from the exact source pixels with a very subtle camera push-in.
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `zoompan=z='min(zoom+0.0006,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
    'format=yuv420p'
  ].join(',');

  await execFileAsync(ffmpegPath, [
    '-y', '-loop', '1', '-i', imagePath,
    '-vf', filter,
    '-frames:v', String(frames),
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', outputPath
  ], { maxBuffer: 2 * 1024 * 1024 });
}

async function runImageJob(job, imagePath, body) {
  let jobDir = '';
  try {
    job.status = 'PROCESSING';
    job.detail = 'Animando la fotografía sin alterar su identidad…';
    jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-photo-'));
    await fs.mkdir(generatedDir, { recursive: true });
    const fileName = `${job.id}.mp4`;
    const outputPath = path.join(generatedDir, fileName);
    await renderIdentitySafeVideo(imagePath, outputPath, body);
    if (job.status === 'CANCELLED') {
      await fs.rm(outputPath, { force: true });
      return;
    }
    if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
    job.outputUrl = `/generated/${fileName}`;
    job.status = 'COMPLETED';
    job.detail = 'Vídeo listo. La fotografía original se conserva sin regeneración de rostro.';
  } catch (error) {
    if (job.status === 'CANCELLED') return;
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'image_generation_failed');
    job.status = 'ERROR';
    job.detail = `${error.message || 'No se pudo animar la fotografía.'} El crédito fue devuelto.`;
  } finally {
    try { await removeTemporaryUpload(job.imageUrl); } catch {}
    if (jobDir) await fs.rm(jobDir, { recursive: true, force: true });
  }
}

function mountImageRoutes(app) {
  if (app._salaImageVideoMounted) return;
  app.post('/api/media/image', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '20mb' }), uploadImage);

  app.post('/api/video/image-to-video', async (req, res) => {
    const body = req.body || {};
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
    if (!body.imageUrl || !String(body.imageUrl).startsWith('/uploads/')) return res.status(400).json({ error: 'Selecciona una fotografía antes de generar.' });
    const imagePath = path.join(uploadsDir, path.basename(String(body.imageUrl).slice('/uploads/'.length)));
    try {
      await fs.access(imagePath);
      const jobId = randomUUID();
      const job = {
        id: jobId,
        status: 'PROCESSING',
        providerState: 'LOCAL_FFMPEG',
        createdAt: Date.now(),
        outputUrl: '',
        detail: 'Preparando animación segura de la fotografía…',
        imageUrl: body.imageUrl,
        userId: req.salaBillingUserId,
        transactionId: req.salaBillingTransactionId
      };
      imageJobs.set(jobId, job);
      runImageJob(job, imagePath, body).catch((error) => {
        job.status = 'ERROR';
        job.detail = error.message || 'No se pudo completar la animación.';
      });
      return res.status(202).json({ job_id: jobId, request_id: jobId });
    } catch (error) {
      if (req.salaBillingUserId && req.salaBillingTransactionId) await refundGeneration(req.salaBillingUserId, req.salaBillingTransactionId, 'image_missing');
      try { await removeTemporaryUpload(body.imageUrl); } catch {}
      return res.status(400).json({ error: 'No se pudo leer la fotografía seleccionada. El crédito fue devuelto.' });
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
