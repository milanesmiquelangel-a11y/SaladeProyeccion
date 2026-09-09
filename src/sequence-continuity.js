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
const PIXAZO_TEXT_URL = process.env.PIXAZO_VIDEO_URL || 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';
const PIXAZO_IMAGE_URL = 'https://gateway.pixazo.ai/ltx-video/v1/image-to-video';
const PIXAZO_STATUS_URL = process.env.PIXAZO_STATUS_URL || 'https://gateway.pixazo.ai/v2/requests/status';
const TIMEOUT_MS = 20 * 60 * 1000;
const publicDir = path.join(process.cwd(), 'public');
const generatedDir = path.join(publicDir, 'generated');
const jobs = new Map();

function dimensions(aspect, quality) {
  const size = quality === 'high' ? 1024 : 768;
  const short = Math.round((size * 9) / 16 / 32) * 32;
  if (aspect === '9:16') return [short, size];
  if (aspect === '1:1') return [size, size];
  return [size, short];
}

function settings(body) {
  const aspect = ['16:9', '9:16', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
  const quality = body.resolution === 'high' ? 'high' : 'standard';
  const fps = Number(body.frameRate) === 30 ? 30 : 24;
  const [width, height] = dimensions(aspect, quality);
  return { aspect, quality, fps, width, height, numFrames: 121 };
}

function publicUrl(req, relative) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return new URL(relative, `${proto}://${req.get('host')}`).toString();
}

function sceneDirection(index, total) {
  const scenes = [
    'ESTABLISHING ROAD. Exterior automotive commercial. A single black Haval M6 compact SUV is driving forward on a clearly visible paved two-lane road through the Kazakhstan steppe. The entire vehicle stays inside one lane, parallel to the road, with all four wheels firmly touching asphalt. Smooth front three-quarter tracking camera. No grass, dirt or off-road driving.',
    'CONTINUATION OF THE SAME DRIVE. Continue directly from the previous shot. The exact same black Haval M6 must remain visually identical to the reference frame: same body shape, color, wheels, lights, windows and proportions. Keep it moving forward in the same lane on the same paved road. Smooth camera motion parallel to the road. No sideways movement, drifting, lane crossing, off-road driving or vehicle redesign.',
    'SAFE STOP. Continue from the previous frame. The same black Haval M6 gradually slows and stops parallel to the same paved road at a safe roadside pickup point. Preserve the exact vehicle identity and scene lighting. The vehicle remains completely on asphalt with natural suspension and shadows. Simple stable camera; no people driving, no vehicle deformation.',
    'PASSENGER PICKUP. Continue from the previous frame. The same black Haval M6 remains stopped at the roadside. One passenger approaches and enters naturally from the passenger side. Keep the vehicle identity, position and environment consistent. Exterior-focused shot, realistic anatomy, no driver visible, no duplicated people.',
    'DEPARTURE. Continue from the previous frame. The same black Haval M6 starts moving forward from the safe pickup point and follows the paved road through the Kazakhstan steppe. Preserve exact vehicle identity and direction. All four wheels stay on asphalt. Smooth realistic acceleration, no sideways sliding, no off-road movement.',
    'HERO CLOSING. Continue from the previous frame. The same black Haval M6 drives forward on the same paved two-lane road through the Kazakhstan steppe at golden hour. Exact same vehicle identity, coherent rigid body, realistic wheels and road contact. Smooth rear three-quarter tracking shot. No deformation or sideways motion.'
  ];
  return `Scene ${index + 1} of ${total}. ${scenes[index % scenes.length]}`;
}

const negative = 'different car, different vehicle, changed car model, changed vehicle color, warped car, deformed car, melted car, duplicate car, extra wheels, missing wheels, floating car, sideways driving, diagonal driving, drifting, car off road, car on grass, car on dirt, wheels off asphalt, wheels floating, vehicle crossing road sideways, impossible steering, impossible perspective, broken road, vehicle morphing, vehicle redesign, vehicle teleporting, vehicle reversing while facing forward, duplicate people, merged people, extra limbs, distorted hands, cartoon, CGI';

async function submit(url, payload, signal) {
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || data?.detail || `Pixazo rechazó la solicitud (HTTP ${response.status}).`);
  const id = data.request_id || data.requestId;
  if (!id) throw new Error('Pixazo no devolvió un identificador de generación.');
  return id;
}

async function wait(requestId, onState, signal) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
    const response = await fetch(`${PIXAZO_STATUS_URL}/${encodeURIComponent(requestId)}`, { signal, headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || data?.error || `Pixazo no pudo consultar el estado (HTTP ${response.status}).`);
    const state = String(data.status || data.state || '').toUpperCase();
    onState?.(state);
    if (state === 'COMPLETED' || state === 'SUCCEEDED' || data.output?.media_url) {
      const raw = data.output?.media_url;
      const url = Array.isArray(raw) ? raw[0] : raw;
      if (!url) throw new Error('Pixazo terminó sin devolver un vídeo.');
      return url;
    }
    if (['ERROR', 'FAILED', 'CANCELLED'].includes(state)) throw Object.assign(new Error(data.error || `La generación terminó con estado ${state}.`), { code: state === 'CANCELLED' ? 'CANCELLED' : 'FAILED' });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw Object.assign(new Error('La generación superó el límite de 20 minutos.'), { code: 'TIMEOUT' });
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el clip generado (HTTP ${response.status}).`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function extractLastFrame(videoPath, framePath) {
  if (!ffmpegPath) throw new Error('FFmpeg no está disponible para conservar la continuidad entre escenas.');
  await execFileAsync(ffmpegPath, ['-y', '-sseof', '-0.15', '-i', videoPath, '-frames:v', '1', '-q:v', '2', framePath], { maxBuffer: 1024 * 1024 });
}

async function assemble(paths, output) {
  const listPath = path.join(path.dirname(output), `concat-${randomUUID()}.txt`);
  const lines = paths.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, `${lines}\n`, 'utf8');
  try {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output], { maxBuffer: 1024 * 1024 });
  } catch {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', output], { maxBuffer: 1024 * 1024 });
  }
  await fs.rm(listPath, { force: true });
}

async function run(job, body) {
  const totalSeconds = Number(body.duration);
  const count = Math.ceil(totalSeconds / 5);
  const cfg = settings(body);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-continuity-'));
  const clips = [];
  const frames = [];
  try {
    let referenceUrl = null;
    for (let index = 0; index < count; index += 1) {
      if (job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
      job.currentScene = index + 1;
      job.totalScenes = count;
      job.detail = referenceUrl ? `Generando escena ${index + 1} de ${count} desde el último fotograma…` : `Generando escena ${index + 1} de ${count}…`;
      const controller = new AbortController();
      job.controller = controller;
      const prompt = `${String(body.prompt || '').trim()}\n\n${sceneDirection(index, count)}\nMASTER CONTINUITY: This scene starts from the exact previous scene's final frame. Preserve the same black Haval M6, same environment, same road direction, same lighting and camera logic. Make only the requested motion change. Photorealistic automotive commercial, physically correct vehicle, realistic road contact.`;
      const payload = referenceUrl
        ? { prompt: prompt.slice(0, 4000), image_url: referenceUrl, strength: 1.0, negative, aspect: cfg.aspect, width: cfg.width, height: cfg.height, num_frames: 121, frame_rate: cfg.fps, enhance_prompt: false }
        : { prompt: prompt.slice(0, 4000), negative, aspect: cfg.aspect, width: cfg.width, height: cfg.height, num_frames: 121, frame_rate: cfg.fps };
      const requestId = await submit(referenceUrl ? PIXAZO_IMAGE_URL : PIXAZO_TEXT_URL, payload, controller.signal);
      job.providerRequestId = requestId;
      const mediaUrl = await wait(requestId, state => { job.providerState = state; job.detail = `Escena ${index + 1} de ${count}: ${state || 'procesando'}…`; }, controller.signal);
      if (job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
      const clipPath = path.join(workDir, `scene-${String(index + 1).padStart(2, '0')}.mp4`);
      await download(mediaUrl, clipPath);
      clips.push(clipPath);
      if (index < count - 1) {
        const framePath = path.join(workDir, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
        await extractLastFrame(clipPath, framePath);
        frames.push(framePath);
        const publicName = `sequence-${job.id}-${String(index + 1).padStart(2, '0')}.jpg`;
        await fs.mkdir(generatedDir, { recursive: true });
        const publicPath = path.join(generatedDir, publicName);
        await fs.copyFile(framePath, publicPath);
        job.referenceFrame = `/generated/${publicName}`;
        referenceUrl = publicUrl(job.req, job.referenceFrame);
      }
      job.controller = null;
    }
    job.detail = 'Uniendo las escenas con continuidad…';
    await fs.mkdir(generatedDir, { recursive: true });
    const outputName = `${job.id}.mp4`;
    await assemble(clips, path.join(generatedDir, outputName));
    await Promise.all(frames.map(async frame => { try { await fs.rm(frame, { force: true }); } catch {} }));
    for (let i = 1; i < count; i += 1) { const p = path.join(generatedDir, `sequence-${job.id}-${String(i).padStart(2, '0')}.jpg`); try { await fs.rm(p, { force: true }); } catch {} }
    if (job.userId && job.transactionId) await finalizeGeneration(job.userId, job.transactionId);
    job.status = 'COMPLETED';
    job.outputUrl = `/generated/${outputName}`;
    job.detail = 'Vídeo promocional listo con continuidad entre escenas.';
  } catch (error) {
    if (job.userId && job.transactionId) await refundGeneration(job.userId, job.transactionId, error?.code === 'CANCELLED' ? 'generation_cancelled' : 'generation_failed');
    job.status = error?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR';
    job.detail = `${error.message || 'No se pudo completar el vídeo.'} El crédito fue devuelto.`;
  } finally {
    job.controller = null;
    await fs.rm(workDir, { recursive: true, force: true });
    for (let i = 1; i < count; i += 1) { const p = path.join(generatedDir, `sequence-${job.id}-${String(i).padStart(2, '0')}.jpg`); try { await fs.rm(p, { force: true }); } catch {} }
  }
}

export function sequencePostHandler(req, res) {
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  const { prompt, negative: userNegative, aspect, duration, resolution, frameRate } = req.body ?? {};
  const allowed = new Set([10, 15, 30, 60]);
  const selectedDuration = allowed.has(Number(duration)) ? Number(duration) : 10;
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  const id = randomUUID();
  const job = { id, status: 'QUEUED', detail: 'Preparando escenas con continuidad…', createdAt: Date.now(), cancelled: false, controller: null, providerRequestId: '', providerState: '', outputUrl: '', req, userId: req.salaBillingUserId, transactionId: req.salaBillingTransactionId };
  jobs.set(id, job);
  run(job, { prompt, negative: [userNegative, negative].filter(Boolean).join(', '), aspect, duration: selectedDuration, resolution, frameRate }).catch(() => {});
  return res.status(202).json({ job_id: id, duration: selectedDuration });
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
