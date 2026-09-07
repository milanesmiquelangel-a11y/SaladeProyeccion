import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
  const directions = ['Opening establishing shot: introduce the location and subject with a cinematic wide view.','Action shot: show the main subject clearly performing the central action with smooth camera movement.','Detail shot: move closer to an important detail, keeping the subject visually consistent.','Interaction shot: show the subject interacting naturally with the environment or product.','Dynamic transition shot: use a smooth tracking or side camera movement to build energy.','Hero shot: present the subject in its strongest, most memorable cinematic composition.','Benefit shot: visually communicate the main value or experience of the story.','Closing shot: finish with a clean premium composition suitable for a promotional ending.'];
  return `Scene ${index + 1} of ${total}. ${directions[index % directions.length]}`;
}

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
      const scenePrompt = `${body.prompt.trim()}\n\n${sceneDirection(index, clipCount)}\nMaintain the same subject, setting, visual style, colors and continuity across all scenes. Photorealistic cinematic advertising quality.`;
      const requestId = await submitPixazo(scenePrompt, body.negative, settings);
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
  const jobId = crypto.randomUUID();
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
