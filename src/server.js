import 'dotenv/config';
import './auth-bridge.js';
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
import { finalizeGeneration, refundGeneration, reserveGeneration } from './billing-ledger.js';
import { getAuthenticatedUserId } from './auth.js';
import billingRouter from './billing-routes.js';
import { checkDatabase } from './database.js';
import { generateKlingVideo, downloadKlingVideo, klingConfigured, klingSupportedNativeLanguages } from './kling-video-provider.js';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const generatedDir = path.join(publicDir, 'generated');
const jobs = new Map();
const billing = new Map();
const TIMEOUT = 20 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api/billing', billingRouter);

app.get('/', async (_req, res) => {
  try {
    let html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
        res.type('html').send(html);
  } catch { res.sendFile(path.join(publicDir, 'index.html')); }
});
app.use(express.static(publicDir));

app.get('/api/health', async (_req, res) => {
  const database = await checkDatabase();
  const ready = klingConfigured();
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: 'sala-de-proyeccion-api',
    provider: 'MiniMax H3 Turbo + Kling VIDEO 3.0',
    generationReady: true,
    h3Available: true,
    h3Space: 'MiniMaxAI/MiniMax-H3-Turbo-Lora',
    klingConfigured: ready,
    nativeAudio: true,
    nativeDialogue: true,
    nativeDialogueLanguages: klingSupportedNativeLanguages(),
    maxNativeDialogueSeconds: 15,
    billingPersistence: database.connected,
    billingDatabase: database.connected ? 'connected' : (database.configured ? 'error' : 'missing'),
    billingDatabaseError: database.connected ? null : database.error,
    sequenceAssembly: Boolean(ffmpegPath),
    generationTimeoutSeconds: TIMEOUT / 1000
  });
});

function normalize(body = {}) {
  const aspect = ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
  const resolution = body.resolution === 'high' ? 'high' : 'standard';
  const duration = Math.round(Number(body.duration) || 5);
  const frameRate = Number(body.frameRate) === 30 ? 30 : 24;
  if (duration < 3 || duration > 15) throw new Error('Kling VIDEO 3.0 permite una toma de 3 a 15 segundos.');
  return { aspect, resolution, duration, frameRate };
}

function clearBilling(id) {
  const entry = billing.get(id);
  if (!entry) return null;
  if (entry.timer) clearTimeout(entry.timer);
  billing.delete(id);
  return entry;
}

app.post('/api/video/generate', async (req, res) => {
  const userId = String(req.get('x-sala-user-id') || '').trim() || await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Inicia sesión antes de generar un vídeo.' });
  if (!klingConfigured()) return res.status(503).json({ error: 'Kling VIDEO 3.0 no está configurado. Añade KLING_API_KEY en Render.' });
  let settings;
  try { settings = normalize(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const prompt = String(req.body?.prompt || '').trim();
  const negative = String(req.body?.negative || '').trim();
  const audioText = String(req.body?.audioText || '').trim();
  const audioLanguage = String(req.body?.audioLanguage || 'en').trim() || 'en';
  if (!prompt) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (prompt.length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  if (audioText.length > 4000) return res.status(400).json({ error: 'audioText no puede superar 4000 caracteres.' });

  const cost = settings.resolution === 'high' ? 2 : 1;
  let reservation;
  try {
    reservation = await reserveGeneration(userId, cost, '/api/video/generate');
  } catch (error) {
    const status = error?.code === 'INSUFFICIENT_CREDITS' ? 402 : 503;
    return res.status(status).json({ error: error.message || 'No se pudo reservar el crédito.', credits: error?.credits ?? null, required: cost, nextRechargeAt: error?.nextRechargeAt ?? null });
  }
  const id = randomUUID();
  const job = { id, status: 'QUEUED', createdAt: Date.now(), cancelled: false, provider: 'Kling VIDEO 3.0', providerState: 'QUEUED', providerRequestId: null, detail: 'Preparando generación…', outputUrl: '', nativeAudio: Boolean(audioText) };
  jobs.set(id, job);
  const timer = setTimeout(async () => {
    const current = jobs.get(id);
    if (!current || ['COMPLETED','ERROR','CANCELLED'].includes(current.status)) return;
    current.cancelled = true;
    current.status = 'ERROR';
    current.detail = 'La generación superó el límite de 20 minutos.';
    const b = clearBilling(id);
    if (b?.userId && b?.transactionId) await refundGeneration(b.userId, b.transactionId, 'generation_timeout');
  }, TIMEOUT);
  billing.set(id, { userId, transactionId: reservation.transactionId, timer });
  res.set('X-Sala-Credits', String(reservation.credits));
  res.set('X-Sala-Cost', String(cost));

  res.status(202).json({ request_id: id, settings, provider: 'Kling VIDEO 3.0', nativeAudio: Boolean(audioText), audioLanguage });

  (async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-kling-'));
    try {
      job.status = 'PROCESSING';
      const result = await generateKlingVideo({ prompt, negative, audioText, audioLanguage, aspect: settings.aspect, duration: settings.duration, resolution: settings.resolution, job });
      job.nativeAudio = Boolean(result.nativeAudio);
      const raw = path.join(workDir, 'kling.mp4');
      await downloadKlingVideo(result.url, raw);
      if (!ffmpegPath) throw new Error('FFmpeg no está disponible para validar el vídeo generado.');
      await fs.mkdir(generatedDir, { recursive: true });
      const output = path.join(generatedDir, `${id}.mp4`);
      const maps = result.nativeAudio ? ['-map', '0:v:0', '-map', '0:a:0'] : ['-map', '0:v:0'];
      const audio = result.nativeAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an'];
      await execFileAsync(ffmpegPath, ['-y', '-i', raw, ...maps, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', output], { maxBuffer: 1024 * 1024 });
      if (result.nativeAudio) {
        const probe = await execFileAsync(ffmpegPath, ['-v','error','-i',output,'-select_streams','a:0','-show_entries','stream=codec_type','-of','csv=p=0']);
        if (!probe.stdout.trim()) throw new Error('Kling terminó sin audio nativo. No se añadirá TTS después: eso no crea sincronización labial.');
      }
      job.status = 'COMPLETED';
      job.outputUrl = `/generated/${id}.mp4`;
      job.detail = result.nativeAudio ? 'Vídeo listo: diálogo, audio y movimiento de boca generados por Kling.' : 'Vídeo listo.';
      const b = clearBilling(id);
      if (b?.userId && b?.transactionId) await finalizeGeneration(b.userId, b.transactionId);
    } catch (error) {
      const b = clearBilling(id);
      if (b?.userId && b?.transactionId) await refundGeneration(b.userId, b.transactionId, error?.code === 'CANCELLED' ? 'generation_cancelled' : 'generation_failed');
      job.status = error?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR';
      job.detail = `${error?.message || 'No se pudo completar la generación.'} El crédito fue devuelto.`;
    } finally { await fs.rm(workDir, { recursive: true, force: true }); }
  })();
});

app.get('/api/video/status/:requestId', (req, res) => {
  const id = String(req.params.requestId || '');
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  res.json({ request_id: id, status: job.status, providerState: job.providerState, detail: job.detail, outputUrl: job.outputUrl, provider: job.provider, nativeAudio: job.nativeAudio });
});

app.post('/api/video/cancel/:requestId', async (req, res) => {
  const id = String(req.params.requestId || '');
  const job = jobs.get(id);
  if (job) job.cancelled = true;
  const b = clearBilling(id);
  if (b?.userId && b?.transactionId) await refundGeneration(b.userId, b.transactionId, 'generation_cancelled');
  res.json({ ok: true, status: 'CANCELLED', request_id: id, creditRefunded: Boolean(b) });
});

app.get('/api/video/file/:jobId', (req, res) => {
  const file = path.join(generatedDir, `${String(req.params.jobId || '')}.mp4`);
  res.sendFile(file, (error) => { if (error && !res.headersSent) res.status(error.statusCode || 404).json({ error: 'Vídeo no encontrado.' }); });
});

app.listen(PORT, () => console.log(`Sala de Proyección API listening on ${PORT}`));
