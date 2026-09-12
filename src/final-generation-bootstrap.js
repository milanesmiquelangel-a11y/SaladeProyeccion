import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';
import { generateSpeechAudio } from './audio-tts.js';

const execFileAsync = promisify(execFile);
const nativePost = express.application.post;
const nativeGet = express.application.get;
const TEXT_URL = process.env.PIXAZO_VIDEO_URL || 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';
const STATUS_URL = process.env.PIXAZO_STATUS_URL || 'https://gateway.pixazo.ai/v2/requests/status';
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const jobs = new Map();
const generatedDir = path.join(process.cwd(), 'public', 'generated');
const audioDir = path.join(process.cwd(), 'public', 'generated-audio');
const TIMEOUT = 20 * 60 * 1000;
const NEGATIVE = 'deformed subject, melted subject, duplicate subject, extra limbs, missing limbs, distorted face, distorted hands, duplicate people, merged bodies, floating objects, impossible physics, warped background, unreadable text, cartoon, CGI, unrelated subject, unrelated scene, cuts, scene changes, time jumps, location changes';

function cfg(body = {}) {
  const aspect = ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
  const high = body.resolution === 'high';
  const fps = Number(body.frameRate) === 30 ? 30 : 24;
  const size = high ? 1024 : 768;
  const short = Math.round((size * 9) / 16 / 32) * 32;
  const [width, height] = aspect === '9:16' ? [short, size] : aspect === '1:1' ? [size, size] : [size, short];
  return { aspect, width, height, fps };
}

function promptFor(base, i, count) {
  const text = String(base || '').trim();
  const instruction = i === 0
    ? 'ONE CONTINUOUS TAKE. Start with exactly the scene, subject, setting and action requested by the user. No cuts, no scene changes, no time jumps, no location changes. Keep the same subject, appearance, setting and camera continuity from beginning to end.'
    : 'Continue the exact same scene and subject naturally. Preserve the requested setting, appearance and action. Do not introduce unrelated subjects or change the story. No cuts, no scene changes, no time jumps.';
  return `${text}\n${instruction} This is segment ${i + 1} of ${count} of one continuous video. The user prompt is authoritative.`.slice(0, 4000);
}

function segmentPlan(total) {
  const plan = [];
  let remaining = total;
  while (remaining > 0) {
    const seconds = remaining >= 10 ? 10 : remaining;
    plan.push(seconds);
    remaining -= seconds;
  }
  return plan;
}

function framesFor(seconds) {
  const fps = 24;
  if (seconds === 5) return 121;
  if (seconds === 10) return 241;
  return Math.max(25, Math.min(241, Math.round(seconds * fps) + 1));
}

async function submit(prompt, negative, settings, seconds, signal) {
  const payload = {
    prompt,
    negative: [negative, NEGATIVE].filter(Boolean).join(', ').slice(0, 4000),
    seed: Math.floor(Math.random() * 2147483647),
    aspect: settings.aspect,
    width: settings.width,
    height: settings.height,
    num_frames: framesFor(seconds),
    frame_rate: settings.fps,
    enhance_prompt: true
  };
  const r = await fetch(TEXT_URL, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || d?.error || d?.detail || `Pixazo rechazó la solicitud (HTTP ${r.status}).`);
  const id = d.request_id || d.requestId;
  if (!id) throw new Error('Pixazo no devolvió un identificador de generación.');
  return id;
}

async function waitFor(id, signal, job) {
  const end = Date.now() + TIMEOUT;
  while (Date.now() < end) {
    if (signal.aborted || job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
    const r = await fetch(`${STATUS_URL}/${encodeURIComponent(id)}`, { signal, headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.message || d?.error || `Pixazo no pudo consultar el estado (HTTP ${r.status}).`);
    const state = String(d.status || d.state || '').toUpperCase();
    job.providerState = state;
    if (state === 'COMPLETED' || state === 'SUCCEEDED' || d.output?.media_url) {
      const raw = d.output?.media_url;
      const url = Array.isArray(raw) ? raw[0] : raw;
      if (!url) throw new Error('Pixazo terminó sin devolver un vídeo.');
      return url;
    }
    if (['ERROR', 'FAILED', 'CANCELLED'].includes(state)) throw Object.assign(new Error(d.error || `La generación terminó con estado ${state}.`), { code: state === 'CANCELLED' ? 'CANCELLED' : 'FAILED' });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw Object.assign(new Error('La generación superó el límite de 20 minutos.'), { code: 'TIMEOUT' });
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar el clip generado (HTTP ${r.status}).`);
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
}

async function normalize(source, target, fps, seconds) {
  if (!ffmpegPath) throw new Error('FFmpeg no está disponible para normalizar el vídeo.');
  const safeSeconds = Math.max(1, Number(seconds) || 5);
  await execFileAsync(ffmpegPath, ['-y', '-i', source, '-map', '0:v:0', '-vf', `fps=${fps},tpad=stop_mode=clone:stop_duration=${safeSeconds}`, '-t', String(safeSeconds), '-frames:v', String(Math.round(fps * safeSeconds)), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', target], { maxBuffer: 1024 * 1024 });
}

async function concat(clips, output) {
  const list = path.join(path.dirname(output), `concat-${randomUUID()}.txt`);
  await fs.writeFile(list, `${clips.map(p => `file '${p.replaceAll("'", "'\\''")}'`).join('\n')}\n`, 'utf8');
  try {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { maxBuffer: 1024 * 1024 });
  } finally { await fs.rm(list, { force: true }); }
}

async function mux(video, audio, output, seconds) {
  await execFileAsync(ffmpegPath, ['-y', '-i', video, '-stream_loop', '-1', '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-t', String(seconds), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output], { maxBuffer: 1024 * 1024 });
}

async function run(job, body) {
  const total = Number(body.duration);
  const plan = segmentPlan(total);
  const count = plan.length;
  const settings = cfg(body);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-final-video-'));
  const clips = [];
  let audioPath = '';
  try {
    for (let i = 0; i < count; i += 1) {
      const seconds = plan[i];
      job.currentScene = i + 1; job.totalScenes = count;
      job.detail = `Generando segmento ${i + 1} de ${count} (${seconds} s) según tu prompt…`;
      const controller = new AbortController(); job.controller = controller;
      const id = await submit(promptFor(body.prompt, i, count), body.negative, settings, seconds, controller.signal);
      job.providerRequestId = id;
      const media = await waitFor(id, controller.signal, job);
      const raw = path.join(work, `raw-${i}.mp4`);
      const clip = path.join(work, `clip-${i}.mp4`);
      await download(media, raw);
      await normalize(raw, clip, settings.fps, seconds);
      await fs.rm(raw, { force: true });
      clips.push(clip);
      job.controller = null;
    }

    await fs.mkdir(generatedDir, { recursive: true });
    const silent = path.join(work, 'silent.mp4');
    job.detail = 'Uniendo el vídeo final…';
    await concat(clips, silent);

    const narration = String(body.audioText || '').trim().slice(0, 4000);
    const finalPath = path.join(generatedDir, `${job.id}.mp4`);
    if (narration) {
      job.providerState = 'GENERATING_AUDIO';
      job.detail = `Generando narración en ${String(body.audioLanguage || 'en')}…`;
      audioPath = await generateSpeechAudio({ text: narration, language: body.audioLanguage || 'en', outputDir: audioDir });
      await mux(silent, audioPath, finalPath, total);
    } else {
      await fs.copyFile(silent, finalPath);
    }

    if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
    job.status = 'COMPLETED';
    job.outputUrl = `/generated/${job.id}.mp4`;
    job.detail = narration ? `Vídeo de ${total} s con audio generado.` : `Vídeo de ${total} s listo.`;
  } catch (error) {
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, error?.code === 'CANCELLED' ? 'generation_cancelled' : 'generation_failed');
    job.status = error?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR';
    job.detail = `${error.message || 'No se pudo completar el vídeo.'} El crédito fue devuelto.`;
  } finally {
    job.controller = null;
    if (audioPath) await fs.rm(audioPath, { force: true }).catch(() => {});
    await fs.rm(work, { recursive: true, force: true });
  }
}

function finalSequencePost(req, res) {
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  const body = req.body || {};
  const allowed = new Set([5, 10, 15, 20, 25, 30, 60]);
  const duration = allowed.has(Number(body.duration)) ? Number(body.duration) : 10;
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (body.prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  if (typeof body.audioText === 'string' && body.audioText.length > 4000) return res.status(400).json({ error: 'El texto de audio no puede superar 4000 caracteres.' });
  const id = randomUUID();
  const job = { id, status: 'QUEUED', detail: 'Preparando generación desde tu prompt…', createdAt: Date.now(), cancelled: false, controller: null, providerRequestId: '', providerState: '', outputUrl: '', req, userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId };
  jobs.set(id, job);
  run(job, { ...body, duration }).catch(() => {});
  return res.status(202).json({ job_id: id, duration, audio: Boolean(String(body.audioText || '').trim()) });
}

function finalGenerationPost(req, res) {
  const body = req.body || {};
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
  const id = randomUUID();
  const job = { id, status: 'QUEUED', detail: 'Preparando generación desde tu prompt…', createdAt: Date.now(), cancelled: false, controller: null, providerRequestId: '', providerState: '', outputUrl: '', req, userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId };
  jobs.set(id, job);
  run(job, { ...body, duration: 5 }).catch(() => {});
  return res.status(202).json({ request_id: id, duration: 5 });
}

function finalSequenceStatus(req, res) {
  const job = jobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  return res.json({ ...job, req: undefined, controller: undefined, userId: undefined, transactionId: undefined });
}

function finalGenerationStatus(req, res) {
  const job = jobs.get(String(req.params.requestId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  if (job.status === 'COMPLETED' && job.outputUrl) return res.json({ status: 'COMPLETED', output: { media_url: [job.outputUrl] } });
  return res.json({ status: job.status, state: job.providerState || job.status, detail: job.detail || '' });
}

async function finalSequenceCancel(req, res) {
  const job = jobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  job.cancelled = true;
  if (job.controller) job.controller.abort();
  let refunded = false;
  if (job.userId && job.transactionId) {
    const result = await refundGeneration(job.userId, job.transactionId, 'generation_cancelled');
    refunded = Boolean(result?.refunded || result?.reason === 'already_finalized_or_missing');
  }
  return res.json({ ok: true, status: 'CANCELLED', job_id: job.id, creditRefunded: refunded });
}

async function finalGenerationCancel(req, res) {
  const job = jobs.get(String(req.params.requestId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  job.cancelled = true;
  if (job.controller) job.controller.abort();
  if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, 'generation_cancelled');
  return res.json({ ok: true, status: 'CANCELLED', creditRefunded: true });
}

express.application.post = function finalPost(route, ...handlers) {
  if (route === '/api/video/sequence' || route === '/api/video/generate') {
    if (handlers.length >= 2) handlers[handlers.length - 1] = route === '/api/video/sequence' ? finalSequencePost : finalGenerationPost;
    return nativePost.call(this, route, ...handlers);
  }
  if (route === '/api/video/sequence/:jobId/cancel') return nativePost.call(this, route, finalSequenceCancel);
  if (route === '/api/video/cancel/:requestId') return nativePost.call(this, route, finalGenerationCancel);
  return nativePost.call(this, route, ...handlers);
};

express.application.get = function finalGet(route, ...handlers) {
  if (route === '/api/video/sequence/:jobId') return nativeGet.call(this, route, finalSequenceStatus);
  if (route === '/api/video/status/:requestId') return nativeGet.call(this, route, finalGenerationStatus);
  return nativeGet.call(this, route, ...handlers);
};
