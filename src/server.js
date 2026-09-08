import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';
import { databaseConfigured, checkDatabase } from './database.js';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const PIXAZO_VIDEO_URL = process.env.PIXAZO_VIDEO_URL || 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';
const PIXAZO_STATUS_URL = process.env.PIXAZO_STATUS_URL || 'https://gateway.pixazo.ai/v2/requests/status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const generatedDir = path.join(publicDir, 'generated');
const sequenceJobs = new Map();
const cancelledRequests = new Set();
const generationBilling = new Map();
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(express.static(publicDir));

app.get('/api/health', async (_req, res) => {
  const database = await checkDatabase();
  const ready = Boolean(PIXAZO_API_KEY) && database.connected;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: 'sala-de-proyeccion-api',
    provider: 'Pixazo LTX 2.5 Free',
    generationReady: ready,
    pixazoConfigured: Boolean(PIXAZO_API_KEY),
    billingPersistence: database.connected,
    billingDatabase: database.connected ? 'connected' : (database.configured ? 'error' : 'missing'),
    billingDatabaseError: database.connected ? null : database.error,
    sequenceAssembly: Boolean(ffmpegPath),
    generationTimeoutSeconds: GENERATION_TIMEOUT_MS / 1000
  });
});

function dimensionsFor(aspect, quality) {
  const size = quality === 'high' ? 1024 : 768;
  const map = { '16:9': [size, Math.round((size * 9) / 16 / 32) * 32], '9:16': [Math.round((size * 9) / 16 / 32) * 32, size], '1:1': [size, size] };
  return map[aspect] || map['16:9'];
}

function frameCountFor(duration, frameRate) {
  const requested = Math.max(1, Number(duration) || 5) * (Number(frameRate) || 24);
  const allowed = [];
  for (let frames = 25; frames <= 121; frames += 8) allowed.push(frames);
  return allowed.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best, allowed[0]);
}

function validateGenerationSettings(body = {}) {
  const allowedAspects = new Set(['16:9', '9:16', '1:1']);
  const selectedAspect = allowedAspects.has(body.aspect) ? body.aspect : '16:9';
  const selectedQuality = body.resolution === 'high' ? 'high' : 'standard';
  const selectedFrameRate = Number(body.frameRate) === 30 ? 30 : 24;
  const [width, height] = dimensionsFor(selectedAspect, selectedQuality);
  const numFrames = frameCountFor(5, selectedFrameRate);
  return { selectedAspect, selectedQuality, selectedFrameRate, width, height, numFrames };
}

async function submitPixazo(prompt, negative, settings, signal) {
  const payload = { prompt: prompt.trim().slice(0, 4000), aspect: settings.selectedAspect, width: settings.width, height: settings.height, num_frames: settings.numFrames, frame_rate: settings.selectedFrameRate };
  if (typeof negative === 'string' && negative.trim()) payload.negative = negative.trim().slice(0, 4000);
  const response = await fetch(PIXAZO_VIDEO_URL, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = data?.message || data?.error || data?.detail;
    throw new Error(providerMessage ? `Pixazo rechazó la solicitud: ${providerMessage}` : `Pixazo rechazó la solicitud (HTTP ${response.status}).`);
  }
  const requestId = data.request_id || data.requestId;
  if (!requestId) throw new Error('Pixazo no devolvió un identificador de generación.');
  return requestId;
}

async function waitForPixazo(requestId, onState, signal, timeoutMs = GENERATION_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
    if (Date.now() >= deadline) throw Object.assign(new Error('La generación superó el límite de 20 minutos y fue cancelada. El crédito fue devuelto.'), { code: 'TIMEOUT' });
    const response = await fetch(`${PIXAZO_STATUS_URL}/${encodeURIComponent(requestId)}`, { signal, headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY } });
    const data = await response.json().catch(() => ({}));