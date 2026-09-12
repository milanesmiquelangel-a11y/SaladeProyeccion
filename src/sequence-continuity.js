import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { finalizeGeneration, refundGeneration } from './billing-ledger.js';

const execFileAsync = promisify(execFile);
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const TEXT_URL = process.env.PIXAZO_VIDEO_URL || 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';
const IMAGE_URL = process.env.PIXAZO_IMAGE_VIDEO_URL || 'https://gateway.pixazo.ai/ltx-video/v1/image-to-video';
const STATUS_URL = process.env.PIXAZO_STATUS_URL || 'https://gateway.pixazo.ai/v2/requests/status';
const jobs = new Map();
const TIMEOUT = 20 * 60 * 1000;
const publicDir = path.join(process.cwd(), 'public');
const generatedDir = path.join(publicDir, 'generated');

const NEGATIVE = 'deformed subject, melted subject, duplicate subject, extra limbs, missing limbs, distorted face, distorted hands, duplicate people, merged bodies, floating objects, impossible physics, warped background, unreadable text, cartoon, CGI';

function config(body = {}) {
  const aspect = ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
  const quality = body.resolution === 'high' ? 'high' : 'standard';
  const fps = Number(body.frameRate) === 30 ? 30 : 24;
  const size = quality === 'high' ? 1024 : 768;
  const short = Math.round((size * 9) / 16 / 32) * 32;
  const [width, height] = aspect === '9:16' ? [short, size] : aspect === '1:1' ? [size, size] : [size, short];
  return { aspect, fps, width, height };
}

function direction(i, total, userPrompt) {
  const base = String(userPrompt || '').trim();
  const directions = [
    'Show the requested subject and action immediately. Use one clear action, realistic motion and a stable composition.',
    'Continue the exact same subject, setting and action described by the user. Preserve visual identity and make only natural movement.',
    'Continue naturally from the previous scene. Keep the user-requested subject and action as the sole visual priority.',
    'Show the next natural moment of the exact user-requested action. Do not introduce unrelated subjects, objects or locations.',
    'Maintain continuity with the user prompt. Keep the same main subject and complete the requested action naturally.',
    'Finish the exact action requested by the user with a clean, coherent final moment.'
  ];
  return `Scene ${i + 1} of ${total}. USER PROMPT IS AUTHORITATIVE: ${base}. ${directions[i % directions.length]} Do not replace the subject or reinterpret the request as a different topic.`;
}

async function submit(url, payload, signal) {
  const r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || d?.error || d?.detail || `Pixazo rechazó la solicitud (HTTP ${r.status}).`);
  const id = d.request_id || d.requestId;
  if (!id) throw new Error('Pixazo no devolvió un identificador de generación.');
  return id;
}

async function waitFor(id, signal, state) {
  const end = Date.now() + TIMEOUT;
  while (Date.now() < end) {
    if (signal.aborted) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
    const r = await fetch(`${STATUS_URL}/${encodeURIComponent(id)}`, { signal, headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.message || d?.error || `Pixazo no pudo consultar el estado (HTTP ${r.status}).`);
    const s = String(d.status || d.state || '').toUpperCase();
    state(s);
    if (s === 'COMPLETED' || s === 'SUCCEEDED' || d.output?.media_url) {
      const raw = d.output?.media_url;
      const url = Array.isArray(raw) ? raw[0] : raw;
      if (!url) throw new Error('Pixazo terminó sin devolver un vídeo.');
      return url;
    }
    if (['ERROR', 'FAILED', 'CANCELLED'].includes(s)) throw Object.assign(new Error(d.error || `La generación terminó con estado ${s}.`), { code: s === 'CANCELLED' ? 'CANCELLED' : 'FAILED' });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw Object.assign(new Error('La generación superó el límite de 20 minutos.'), { code: 'TIMEOUT' });
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar el clip generado (HTTP ${r.status}).`);
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
}

async function normalize(source, target, fps) {
  if (!ffmpegPath) throw new Error('FFmpeg no está disponible para normalizar las escenas.');
  const frames = fps * 5;
  await execFileAsync(ffmpegPath, ['-y', '-i', source, '-map', '0:v:0', '-vf', `fps=${fps}`, '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', target], { maxBuffer: 1024 * 1024 });
}

async function lastFrame(video, image) {
  await execFileAsync(ffmpegPath, ['-y', '-sseof', '-0.12', '-i', video, '-frames:v', '1', '-q:v', '2', image], { maxBuffer: 1024 * 1024 });
}

async function concat(paths, output) {
  const list = path.join(path.dirname(output), `concat-${randomUUID()}.txt`);
  await fs.writeFile(list, `${paths.map(p => `file '${p.replaceAll("'", "'\\''")}'`).join('\n')}\n`, 'utf8');
  try {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', output], { maxBuffer: 1024 * 1024 });
  } finally { await fs.rm(list, { force: true }); }
}

async function run(job, body) {
  const total = Number(body.duration);
  const count = Math.ceil(total / 5);
  const cfg = config(body);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-sequence-'));
  const clips = [];
  try {
    let reference = null;
    for (let i = 0; i < count; i += 1) {
      if (job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
      job.currentScene = i + 1; job.totalScenes = count;
      job.detail = reference ? `Generando escena ${i + 1} de ${count} desde el último fotograma…` : `Generando escena ${i + 1} de ${count}…`;
      const controller = new AbortController(); job.controller = controller;
      const prompt = `${direction(i, count, body.prompt)}\nVISUAL RULES: follow the user's prompt literally. Preserve the same subject, action, setting and style. Use photorealistic natural motion, coherent anatomy and stable composition. Do not add an unrelated theme.`;
      const payload = reference
        ? { prompt: prompt.slice(0, 4000), image_url: reference, strength: 1.0, negative: NEGATIVE, aspect: cfg.aspect, width: cfg.width, height: cfg.height, num_frames: 121, frame_rate: cfg.fps, enhance_prompt: false }
        : { prompt: prompt.slice(0, 4000), negative: NEGATIVE, aspect: cfg.aspect, width: cfg.width, height: cfg.height, num_frames: 121, frame_rate: cfg.fps };
      const id = await submit(reference ? IMAGE_URL : TEXT_URL, payload, controller.signal);
      job.providerRequestId = id;
      const media = await waitFor(id, controller.signal, s => { job.providerState = s; job.detail = `Escena ${i + 1} de ${count}: ${s || 'procesando'}…`; });
      const raw = path.join(work, `raw-${i}.mp4`);
      const clip = path.join(work, `clip-${i}.mp4`);
      await download(media, raw);
      await normalize(raw, clip, cfg.fps);
      await fs.rm(raw, { force: true });
      clips.push(clip);
      if (i < count - 1) {
        const frame = path.join(work, `frame-${i}.jpg`);
        await lastFrame(clip, frame);
        await fs.mkdir(generatedDir, { recursive: true });
        const publicName = `sequence-${job.id}-${i + 1}.jpg`;
        await fs.copyFile(frame, path.join(generatedDir, publicName));
        job.referenceFrame = `/generated/${publicName}`;
        const proto = String(job.req.get('x-forwarded-proto') || job.req.protocol || 'https').split(',')[0];
        reference = new URL(job.referenceFrame, `${proto}://${job.req.get('host')}`).toString();
      }
      job.controller = null;
    }
    await fs.mkdir(generatedDir, { recursive: true });
    const output = path.join(generatedDir, `${job.id}.mp4`);
    job.detail = 'Uniendo las escenas con continuidad…';
    await concat(clips, output);
    for (let i = 1; i < count; i += 1) { try { await fs.rm(path.join(generatedDir, `sequence-${job.id}-${i}.jpg`), { force: true }); } catch {} }
    if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
    job.status = 'COMPLETED'; job.outputUrl = `/generated/${job.id}.mp4`; job.detail = `Vídeo promocional listo: ${total} s exactos.`;
  } catch (e) {
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, e?.code === 'CANCELLED' ? 'generation_cancelled' : 'generation_failed');
    job.status = e?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR'; job.detail = `${e.message || 'No se pudo completar el vídeo.'} El crédito fue devuelto.`;
  } finally {
    job.controller = null;
    await fs.rm(work, { recursive: true, force: true });
    for (let i = 1; i < count; i += 1) { try { await fs.rm(path.join(generatedDir, `sequence-${job.id}-${i}.jpg`), { force: true }); } catch {} }
  }
}

export function sequencePostHandler(req, res) {
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  const { prompt, negative, aspect, duration, resolution, frameRate } = req.body ?? {};
  const allowed = new Set([10, 15, 30, 60]);
  const selected = allowed.has(Number(duration)) ? Number(duration) : 10;
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  const id = randomUUID();
  const job = { id, status: 'QUEUED', detail: 'Preparando escenas con continuidad…', createdAt: Date.now(), cancelled: false, controller: null, providerRequestId: '', providerState: '', outputUrl: '', req, userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId };
  jobs.set(id, job);
  run(job, { prompt, negative, aspect, duration: selected, resolution, frameRate }).catch(() => {});
  return res.status(202).json({ job_id: id, duration: selected });
}

export function sequenceStatusHandler(req, res) {
  const job = jobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ error: 'No se encontró la generación.' });
  return res.json({ ...job, req: undefined, controller: undefined, userId: undefined, transactionId: undefined });
}

export async function sequenceCancelHandler(req, res) {
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
