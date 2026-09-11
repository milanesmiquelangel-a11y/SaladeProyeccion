import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const outputDir = path.join(publicDir, 'free-image-video');

const VIDEO_SPACE = process.env.SADTALKER_FREE_SPACE || 'henrybit/SadTalker-Demo';
const VIDEO_ENDPOINT = process.env.SADTALKER_FREE_ENDPOINT || '/generate';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();
const FINAL_DURATION_SECONDS = 5;

function pickValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickValue(item);
      if (picked) return picked;
    }
    return '';
  }
  if (typeof value === 'object') {
    return value.url || value.path || value.name || value.video?.url || value.video?.path || '';
  }
  return '';
}

function describeError(error) {
  const message = error?.message || String(error || 'Error desconocido');
  const cause = error?.cause?.message ? ` (${error.cause.message})` : '';
  const details = error?.details ? ` ${String(error.details).slice(0, 1000)}` : '';
  return `${message}${cause}${details}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible en el servidor.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function trimAudioToFiveSeconds(audioPath) {
  const filename = `sadtalker-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`;
  const destination = path.join(outputDir, filename);
  await fs.mkdir(outputDir, { recursive: true });
  await runFfmpeg([
    '-y', '-i', audioPath,
    '-af', `apad=pad_dur=${FINAL_DURATION_SECONDS}`,
    '-t', String(FINAL_DURATION_SECONDS),
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    destination
  ]);
  return destination;
}

async function saveVideoResult(value) {
  const videoValue = pickValue(value);
  if (!videoValue) throw new Error('SadTalker terminó sin devolver el vídeo generado.');
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `sadtalker-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const destination = path.join(outputDir, filename);

  if (videoValue.startsWith('data:')) {
    const comma = videoValue.indexOf(',');
    if (comma < 0) throw new Error('SadTalker devolvió un vídeo en formato no válido.');
    await fs.writeFile(destination, Buffer.from(videoValue.slice(comma + 1), 'base64'));
  } else if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, destination);
  }
  return destination;
}

async function normalizeVideo(sourcePath) {
  const filename = `sadtalker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const destination = path.join(outputDir, filename);
  await runFfmpeg([
    '-y', '-i', sourcePath,
    '-t', String(FINAL_DURATION_SECONDS),
    '-r', '25',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    destination
  ]);
  return `/free-image-video/${filename}`;
}

function findEndpoint(api) {
  const named = api?.named_endpoints || {};
  if (named[VIDEO_ENDPOINT]) return VIDEO_ENDPOINT;
  const candidates = Object.entries(named).filter(([, spec]) => {
    const params = Array.isArray(spec?.parameters) ? spec.parameters : [];
    const labels = params.map((p) => `${p?.label || ''} ${p?.parameter_name || ''}`.toLowerCase()).join(' ');
    return params.length >= 6 && labels.includes('image') && labels.includes('audio');
  });
  if (candidates.length) return candidates[0][0];
  const all = Object.keys(named);
  if (all.length === 1) return all[0];
  return '';
}

/**
 * Audio-driven talking-head generation from one photograph.
 * The voice audio drives mouth, facial expression, blinking and head motion.
 */
export async function generateFreeSadTalkerVideo({ imagePath, audioPath }) {
  let sourcePath = '';
  let preparedAudioPath = '';
  try {
    if (!HF_TOKEN) {
      throw new Error('Hugging Face requiere autenticación. Configura HF_TOKEN en Render con un token personal con permiso Read.');
    }
    if (!imagePath) throw new Error('No se encontró la fotografía temporal para animar.');
    if (!audioPath) throw new Error('No se encontró el audio que debe mover la boca de la persona.');

    preparedAudioPath = await trimAudioToFiveSeconds(audioPath);

    const { Client, handle_file } = await import('@gradio/client');
    const app = await Client.connect(VIDEO_SPACE, { token: HF_TOKEN });
    const api = await app.view_api();
    const endpoint = findEndpoint(api);
    if (!endpoint) {
      const available = Object.keys(api?.named_endpoints || {}).join(', ');
      throw new Error(`El Space ${VIDEO_SPACE} no expone un endpoint SadTalker compatible. Endpoints: ${available || 'ninguno'}.`);
    }

    // Current official ZeroGPU demo inputs:
    // source_image, driven_audio, preprocess, still_mode, pose_style, expression_scale.
    const result = await app.predict(endpoint, [
      handle_file(imagePath),
      handle_file(preparedAudioPath),
      'full',
      false,
      0,
      1.15
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickValue(item?.video || item)) || data[0];
    sourcePath = await saveVideoResult(output?.video || output);
    const outputUrl = await normalizeVideo(sourcePath);

    return {
      outputUrl,
      provider: `SadTalker (${VIDEO_SPACE})`,
      detail: 'Vídeo hablado generado con SadTalker: la voz conduce la boca, expresiones, parpadeo y pequeños movimientos de cabeza.'
    };
  } catch (error) {
    throw new Error(`SadTalker no pudo generar el vídeo hablado: ${describeError(error)}`);
  } finally {
    if (sourcePath) await fs.rm(sourcePath, { force: true }).catch(() => {});
    if (preparedAudioPath) await fs.rm(preparedAudioPath, { force: true }).catch(() => {});
  }
}
