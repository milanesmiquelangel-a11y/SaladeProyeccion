import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { checkDatabase } from './database.js';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';
import { generateSpeechAudio, muxAudioIntoVideo, normalizeAudioLanguage } from './audio-tts.js';
import { generateWanVideo, cancelWanVideo } from './wan-video-provider.js';

const execFileAsync = promisify(execFile);
const nativePost = express.application.post;
const nativeGet = express.application.get;
const jobs = new Map();
const generatedDir = path.join(process.cwd(), 'public', 'generated');
const audioDir = path.join(process.cwd(), 'public', 'generated-audio');
const TIMEOUT_MS = 20 * 60 * 1000;
const ALLOWED_DURATIONS = new Set([5, 10, 15, 20, 25, 30, 60]);
const NEGATIVE = 'unrelated subject, unrelated object, deformed subject, melted subject, duplicate subject, extra limbs, missing limbs, distorted face, distorted hands, merged bodies, floating objects, impossible physics, warped background, unreadable text, cartoon, CGI, frozen frame, static image';

function settings(body = {}) {
  const aspect = ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
  return { aspect, resolution: body.resolution === 'high' ? 'high' : 'standard', fps: Number(body.frameRate) === 30 ? 30 : 24 };
}

function promptFor(base, index, total, continued) {
  const clean = String(base || '').trim().slice(0, 3600);
  const continuity = continued
    ? 'Continue directly from the supplied final frame. Preserve the exact same subject, identity, environment, lighting and camera style. Continue the action naturally; do not restart, jump in time or introduce unrelated subjects.'
    : 'Follow the user request exactly. Keep the requested subject, action and environment as the dominant content. Do not substitute a different subject or add an unrelated scene.';
  return `${clean}\n\n${continuity}\nThis is segment ${index + 1} of ${total} of one continuous video.`;
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function hasRealMotion(file) {
  if (!ffmpegPath) return true;
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-v', 'error', '-i', file, '-vf', 'fps=2,format=gray', '-f', 'framemd5', '-'], { maxBuffer: 4 * 1024 * 1024 });
    const hashes = stdout.split(/\r?\n/).filter((line) => /^0,/.test(line)).map((line) => line.trim().split(',').pop());
    if (hashes.length < 4) return true;
    let same = 0;
    for (let i = 1; i < hashes.length; i += 1) if (hashes[i] === hashes[i - 1]) same += 1;
    return same / (hashes.length - 1) < 0.9;
  } catch (_) { return true; }
}

async function normalize(source, target, fps, seconds) {
  await execFileAsync(ffmpegPath, ['-y', '-i', source, '-map', '0:v:0', '-vf', `fps=${fps},tpad=stop_mode=clone:stop_duration=1`, '-t', String(seconds), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target], { maxBuffer: 1024 * 1024 });
}

async function lastFrame(video, image) {
  await execFileAsync(ffmpegPath, ['-y', '-sseof', '-0.15', '-i', video, '-frames:v', '1', '-q:v', '2', image], { maxBuffer: 1024 * 1024 });
}

async function concat(clips, output) {
  const list = path.join(path.dirname(output), `concat-${randomUUID()}.txt`);
  await fs.writeFile(list, `${clips.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join('\n')}\n`, 'utf8');
  try {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { maxBuffer: 1024 * 1024 });
  } finally { await fs.rm(list, { force: true }); }
}

async function run(job, body) {
  const total = ALLOWED_DURATIONS.has(Number(body.duration)) ? Number(body.duration) : 5;
  const cfg = settings(body);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-wan-'));
  const clips = [];
  let audioPath = '';
  try {
    const count = Math.ceil(total / 5);
    let reference = '';
    for (let index = 0; index < count; index += 1) {
      if (job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
      const seconds = index === count - 1 && total % 5 ? total % 5 : 5;
      job.currentScene = index + 1;
      job.totalScenes = count;
      job.detail = reference ? `Generando escena ${index + 1} de ${count} con continuidad…` : `Generando escena ${index + 1} de ${count} con WAN 2.2…`;
      const mediaUrl = await generateWanVideo({
        prompt: promptFor(body.prompt, index, count, Boolean(reference)),
        negative: [body.negative, NEGATIVE].filter(Boolean).join(', '),
        aspect: cfg.aspect,
        imagePath: reference,
        job
      });
      if (job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
      const raw = path.join(work, `raw-${index}.mp4`);
      const clip = path.join(work, `clip-${index}.mp4`);
      await download(mediaUrl, raw);
      if (!(await hasRealMotion(raw))) throw new Error(`WAN 2.2 devolvió una escena sin movimiento real (escena ${index + 1}).`);
      await normalize(raw, clip, cfg.fps, seconds);
      await fs.rm(raw, { force: true });
      clips.push(clip);
      reference = '';
      if (index < count - 1) {
        reference = path.join(work, `frame-${index}.jpg`);
        await lastFrame(clip, reference);
      }
    }

    await fs.mkdir(generatedDir, { recursive: true });
    const silent = path.join(work, 'silent.mp4');
    job.providerState = 'ASSEMBLING';
    job.detail = 'Uniendo las escenas y preparando el vídeo final…';
    await concat(clips, silent);

    const narration = String(body.audioText || '').trim().slice(0, 4000);
    const finalPath = path.join(generatedDir, `${job.id}.mp4`);
    if (narration) {
      job.providerState = 'GENERATING_AUDIO';
      job.detail = `Generando narración en ${normalizeAudioLanguage(body.audioLanguage || 'en')}…`;
      audioPath = await generateSpeechAudio({ text: narration, language: body.audioLanguage || 'en', outputDir: audioDir });
      await muxAudioIntoVideo({ videoPath: silent, audioPath, outputPath: finalPath, durationSeconds: total });
    } else {
      await fs.copyFile(silent, finalPath);
    }

    if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
    job.status = 'COMPLETED';
    job.providerState = 'COMPLETED';
    job.outputUrl = `/generated/${job.id}.mp4`;
    job.detail = narration ? `Vídeo de ${total} s con narración ${normalizeAudioLanguage(body.audioLanguage || 'en')}.` : `Vídeo de ${total} s generado con WAN 2.2.`;
  } catch (error) {
    console.error('[FINAL GENERATION]', error?.stack || error);
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, error?.code === 'CANCELLED' ? 'generation_cancelled' : 'generation_failed');
    job.status = error?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR';
    job.providerState = error?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR';
    job.detail = `${error?.message || 'No se pudo completar la generación.'} El crédito fue devuelto.`;
  } finally {
    cancelWanVideo(job);
    if (audioPath) await fs.rm(audioPath, { force: true }).catch(() => {});
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function createJob(req, body, forcedDuration = null) {
  const duration = forcedDuration || (ALLOWED_DURATIONS.has(Number(body.duration)) ? Number(body.duration) : 5);
  const id = randomUUID();
  const job = {
    id, status: 'QUEUED', providerState: 'QUEUED', providerEndpoint: '', providerRequestId: '',
    createdAt: Date.now(), cancelled: false, controller: null, currentScene: 0, totalScenes: Math.ceil(duration / 5),
    outputUrl: '', detail: 'Preparando generación…', req, userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId
  };
  jobs.set(id, job);
  run(job, { ...body, duration }).catch((error) => console.error('[JOB]', error));
  return { job, duration };
}

function generationPost(req, res) {
  const body = req.body || {};
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (body.prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  if (String(body.audioText || '').length > 4000) return res.status(400).json({ error: 'El texto de audio no puede superar 4000 caracteres.' });
  const { job, duration } = createJob(req, body, 5);
  return res.status(202).json({ request_id: job.id, requestId: job.id, duration, provider: 'WAN 2.2 ZeroGPU', audio: Boolean(String(body.audioText || '').trim()) });
}

function sequencePost(req, res) {
  const body = req.body || {};
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (body.prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  if (String(body.audioText || '').length > 4000) return res.status(400).json({ error: 'El texto de audio no puede superar 4000 caracteres.' });
  const duration = ALLOWED_DURATIONS.has(Number(body.duration)) ? Number(body.duration) : 10;
  const { job } = createJob(req, body, duration);
  return res.status(202).json({ job_id: job.id, duration, provider: 'WAN 2.2 ZeroGPU', audio: Boolean(String(body.audioText || '').trim()) });
}

function generationStatus(req, res) {
  const job = jobs.get(String(req.params.requestId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  return res.json({ id: job.id, status: job.status, providerState: job.providerState, detail: job.detail, outputUrl: job.outputUrl, currentScene: job.currentScene, totalScenes: job.totalScenes });
}

function sequenceStatus(req, res) {
  const job = jobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la producción.' });
  return res.json({ id: job.id, status: job.status, providerState: job.providerState, detail: job.detail, outputUrl: job.outputUrl, currentScene: job.currentScene, totalScenes: job.totalScenes });
}

async function cancelGeneration(req, res) {
  const job = jobs.get(String(req.params.requestId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  if (!['COMPLETED', 'ERROR', 'CANCELLED'].includes(job.status)) {
    job.cancelled = true;
    job.status = 'CANCELLED';
    cancelWanVideo(job);
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'generation_cancelled');
  }
  return res.json({ ok: true, status: 'CANCELLED', creditRefunded: true });
}

function sequenceCancel(req, res) {
  return cancelGeneration({ ...req, params: { requestId: req.params.jobId } }, res);
}

express.application.post = function finalPost(route, ...handlers) {
  if (route === '/api/video/generate') return nativePost.call(this, route, ...handlers.slice(0, -1), generationPost);
  if (route === '/api/video/sequence') return nativePost.call(this, route, ...handlers.slice(0, -1), sequencePost);
  if (route === '/api/video/cancel/:requestId') return nativePost.call(this, route, cancelGeneration);
  if (route === '/api/video/sequence/:jobId/cancel') return nativePost.call(this, route, sequenceCancel);
  return nativePost.call(this, route, ...handlers);
};

express.application.get = function finalGet(route, ...handlers) {
  if (route === '/api/video/status/:requestId') return nativeGet.call(this, route, generationStatus);
  if (route === '/api/video/sequence/:jobId') return nativeGet.call(this, route, sequenceStatus);
  if (route === '/api/health') {
    return nativeGet.call(this, route, async (_req, res) => {
      const database = await checkDatabase();
      return res.status(200).json({
        ok: true,
        service: 'sala-de-proyeccion-api',
        provider: 'WAN 2.2 5B · Hugging Face ZeroGPU',
        generationReady: true,
        videoEngine: 'WAN 2.2',
        audioEngine: 'Edge TTS + Google fallback',
        billingPersistence: database.connected,
        billingDatabase: database.connected ? 'connected' : (database.configured ? 'error' : 'missing'),
        billingDatabaseError: database.connected ? null : database.error,
        sequenceAssembly: Boolean(ffmpegPath),
        generationTimeoutSeconds: TIMEOUT_MS / 1000
      });
    });
  }
  return nativeGet.call(this, route, ...handlers);
};
