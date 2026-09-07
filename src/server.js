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

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'sala-de-proyeccion-api', provider: 'Pixazo LTX 2.5 Free', generationReady: Boolean(PIXAZO_API_KEY), pixazoConfigured: Boolean(PIXAZO_API_KEY), sequenceAssembly: Boolean(ffmpegPath) });
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

async function submitPixazo(prompt, negative, settings) {
  const payload = { prompt: prompt.trim().slice(0, 4000), aspect: settings.selectedAspect, width: settings.width, height: settings.height, num_frames: settings.numFrames, frame_rate: settings.selectedFrameRate };
  if (typeof negative === 'string' && negative.trim()) payload.negative = negative.trim().slice(0, 4000);
  const response = await fetch(PIXAZO_VIDEO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = data?.message || data?.error || data?.detail;
    throw new Error(providerMessage ? `Pixazo rechazó la solicitud: ${providerMessage}` : `Pixazo rechazó la solicitud (HTTP ${response.status}).`);
  }
  const requestId = data.request_id || data.requestId;
  if (!requestId) throw new Error('Pixazo no devolvió un identificador de generación.');
  return requestId;
}

async function waitForPixazo(requestId, onState) {
  for (;;) {
    const response = await fetch(`${PIXAZO_STATUS_URL}/${encodeURIComponent(requestId)}`, { headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = data?.message || data?.error || data?.detail;
      throw new Error(providerMessage ? `Pixazo no pudo consultar el trabajo: ${providerMessage}` : `Pixazo no pudo consultar el trabajo (HTTP ${response.status}).`);
    }
    const state = String(data.status || data.state || '').toUpperCase();
    onState?.(state);
    if (state === 'COMPLETED' || state === 'SUCCEEDED' || data.output?.media_url) {
      const rawUrl = data.output?.media_url; const url = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
      if (!url) throw new Error('Pixazo terminó sin devolver un vídeo.');
      return url;
    }
    if (['ERROR', 'FAILED', 'CANCELLED'].includes(state)) throw new Error(data.error || `La generación terminó con estado ${state}.`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function downloadVideo(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el clip generado (HTTP ${response.status}).`);
  await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}

async function assembleClips(clipPaths, outputPath) {
  if (!ffmpegPath) throw new Error('FFmpeg no está disponible para unir las escenas.');
  const tempDir = path.dirname(outputPath);
  const listPath = path.join(tempDir, 'concat.txt');
  const lines = clipPaths.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, `${lines}\n`, 'utf8');
  try {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath], { maxBuffer: 1024 * 1024 });
  } catch {
    await execFileAsync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', outputPath], { maxBuffer: 1024 * 1024 });
  }
  await fs.rm(listPath, { force: true });
}

function sceneDirection(index, total) {
  const directions = [
    'SCENE 1 — ESTABLISHING ROAD. Exterior only. A black Haval M6 compact SUV is completely on a paved two-lane road in the Kazakhstan steppe. The road must be clearly visible under all four wheels. The vehicle travels forward in the same direction as the road, centered in its lane. Camera tracks from the front three-quarter angle. No dirt driving, no grass driving, no off-road movement, no people visible.',
    'SCENE 2 — NORMAL DRIVING. Exterior tracking shot only. The exact same black Haval M6 travels FORWARD on a clearly paved road. Four wheels remain firmly on the asphalt and aligned with the road. The vehicle body stays physically coherent and rigid. Camera moves parallel to the road; do not rotate the vehicle sideways. No jumps, drifting, floating, reversing, teleporting or off-road driving. No interior view and no people.',
    'SCENE 3 — APP PHONE DETAIL. The car is PARKED SAFELY on the shoulder beside the paved road, fully stationary. Close-up of one passenger holding a generic smartphone with a simple blue taxi-app interface. The phone is the visual focus. The person is seated normally in the front passenger seat, not driving. Steering wheel is not visible. No readable text, no distorted fingers, no moving vehicle.',
    'SCENE 4 — ARRIVAL. Exterior only. The same black Haval M6 approaches and stops normally on the paved road beside a safe roadside pickup point. The vehicle remains parallel to the road with all four wheels on asphalt. Show one passenger standing outside the vehicle near the pickup point, waiting safely. Do not show people inside the cabin. No off-road driving, no sideways vehicle, no deformed car.',
    'SCENE 5 — SIMPLE PASSENGER MOMENT. Static exterior shot at the stopped car. One passenger enters the front passenger side naturally; keep the body fully visible and anatomically correct. The driver is NOT visible in this shot. Do not show two people in one seat. Avoid complex interior anatomy and avoid showing the steering wheel.',
    'SCENE 6 — HERO CLOSING. Exterior automotive commercial hero shot. The same black Haval M6 drives FORWARD on a clearly visible paved two-lane road through the Kazakhstan steppe. All four wheels stay on the asphalt, vehicle remains aligned with the road, realistic suspension and natural motion. Camera follows smoothly from a rear three-quarter or front three-quarter angle. No people, no interior, no off-road movement, no deformations.'
  ];
  return `Scene ${index + 1} of ${total}. ${directions[index % directions.length]}`;
}

function continuityRules() {
  return `MASTER CONTINUITY RULES: This is a professional automotive commercial. Preserve the same black Haval M6 compact SUV throughout. The vehicle must have one coherent rigid body, four normal wheels, four wheel arches, two headlights and physically correct proportions. NEVER deform, duplicate, melt, stretch, bend, mirror or morph the vehicle. Whenever the vehicle moves, it MUST be completely on a clearly visible paved road; every wheel touches asphalt and the vehicle is aligned with the road direction. NEVER drive across grass, fields, dirt, sand or diagonally sideways. NEVER make the car float, slide sideways, travel backwards while facing forward, jump, teleport or change shape. Use realistic tire rotation, suspension, shadows and road contact. Keep Kazakhstan steppe, golden-hour light and premium photorealistic automotive cinematography consistent. Prefer simple shots with one clear action. Avoid complex multi-person interior scenes because anatomy and seat placement must remain realistic. If a person appears, use one person at a time unless the scene explicitly requires otherwise; never merge bodies, duplicate limbs or place two people in one seat. No readable generated text on phones, signs or license plates.`;
}

const safetyNegative = 'deformed car, malformed vehicle, warped vehicle, melted car, duplicated car, extra wheels, missing wheels, extra tires, broken axle, floating car, sideways driving, diagonal driving, drifting, car off road, car on grass, car in field, car on dirt, car in sand, wheels off asphalt, wheels floating, vehicle crossing road sideways, impossible steering, impossible perspective, distorted road, broken road, duplicate people, merged people, fused bodies, extra arms, extra legs, extra heads, passenger driving, two people in one seat, person behind steering wheel when not driver, distorted hands, unreadable text, warped smartphone, cartoon, CGI look';

async function runSequence(jobId, body) {
  const totalSeconds = Number(body.duration);
  const clipCount = Math.ceil(totalSeconds / 5);
  const settings = validateGenerationSettings(body);
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sala-sequence-'));
  const clipPaths = [];
  const job = sequenceJobs.get(jobId);
  try {
    for (let index = 0; index < clipCount; index += 1) {
      job.status = 'PROCESSING'; job.currentScene = index + 1; job.totalScenes = clipCount; job.detail = `Generando escena ${index + 1} de ${clipCount}…`;
      const scenePrompt = `${body.prompt.trim()}\n\n${sceneDirection(index, clipCount)}\n${continuityRules()}\nVisual style: photorealistic cinematic commercial, realistic physics, natural motion, professional automotive advertising, physically correct road contact, clean composition.`;
      const combinedNegative = [body.negative?.trim(), safetyNegative].filter(Boolean).join(', ');
      const requestId = await submitPixazo(scenePrompt, combinedNegative, settings);
      job.providerRequestId = requestId;
      const mediaUrl = await waitForPixazo(requestId, (state) => { job.providerState = state; job.detail = `Escena ${index + 1} de ${clipCount}: ${state || 'procesando'}…`; });
      const clipPath = path.join(jobDir, `scene-${String(index + 1).padStart(2, '0')}.mp4`);
      await downloadVideo(mediaUrl, clipPath); clipPaths.push(clipPath);
    }
    job.detail = 'Uniendo las escenas en el vídeo final…';
    await fs.mkdir(generatedDir, { recursive: true });
    const fileName = `${jobId}.mp4`; const outputPath = path.join(generatedDir, fileName);
    await assembleClips(clipPaths, outputPath);
    job.status = 'COMPLETED'; job.detail = 'Vídeo promocional listo.'; job.outputUrl = `/generated/${fileName}`;
  } catch (error) {
    console.error('Sequence generation error:', error); job.status = 'ERROR'; job.detail = error.message || 'No se pudo completar el vídeo.';
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}

app.post('/api/video/generate', async (req, res) => {
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  const { prompt, negative, aspect, duration, resolution, frameRate } = req.body ?? {};
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  const selectedDuration = Number(duration) === 4 ? 4 : 5;
  const settings = validateGenerationSettings({ aspect, resolution, frameRate });
  try {
    const requestId = await submitPixazo(prompt, negative, settings);
    return res.status(202).json({ request_id: requestId, settings: { aspect: settings.selectedAspect, duration: selectedDuration, resolution: settings.selectedQuality, frameRate: settings.selectedFrameRate, width: settings.width, height: settings.height, numFrames: settings.numFrames } });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'No se pudo generar el vídeo.' });
  }
});

app.post('/api/video/sequence', async (req, res) => {
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  const { prompt, negative, aspect, duration, resolution, frameRate } = req.body ?? {};
  const allowedDurations = new Set([10, 15, 30, 60]);
  const selectedDuration = Number(duration);
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return res.status(400).json({ error: 'prompt es obligatorio.' });
  if (prompt.trim().length > 4000) return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  if (!allowedDurations.has(selectedDuration)) return res.status(400).json({ error: 'La duración promocional debe ser 10, 15, 30 o 60 segundos.' });
  const jobId = randomUUID();
  sequenceJobs.set(jobId, { id: jobId, status: 'QUEUED', currentScene: 0, totalScenes: Math.ceil(selectedDuration / 5), providerState: 'QUEUED', detail: 'Producción en cola…', outputUrl: '' });
  runSequence(jobId, { prompt: prompt.trim(), negative, aspect, duration: selectedDuration, resolution, frameRate }).catch((error) => { const job = sequenceJobs.get(jobId); if (job) { job.status = 'ERROR'; job.detail = error.message || 'Error inesperado.'; } });
  return res.status(202).json({ job_id: jobId, duration: selectedDuration, scenes: Math.ceil(selectedDuration / 5) });
});

app.get('/api/video/sequence/:jobId', (req, res) => {
  const job = sequenceJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'No se encontró la producción.' });
  return res.json(job);
});

app.get('/api/video/status/:requestId', async (req, res) => {
  if (!PIXAZO_API_KEY) return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  const requestId = encodeURIComponent(req.params.requestId);
  try {
    const response = await fetch(`${PIXAZO_STATUS_URL}/${requestId}`, { headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = data?.message || data?.error || data?.detail;
      return res.status(response.status).json({ error: providerMessage ? `Pixazo no pudo consultar el trabajo: ${providerMessage}` : `Pixazo no pudo consultar el trabajo (HTTP ${response.status}).`, details: data });
    }
    return res.json(data);
  } catch (error) {
    console.error('Pixazo status error:', error); return res.status(502).json({ error: 'No se pudo consultar el estado en Pixazo.' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
fs.mkdir(generatedDir, { recursive: true }).catch(() => {});
app.listen(PORT, () => console.log(`Sala de Proyección escuchando en http://localhost:${PORT}`));
