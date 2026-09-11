import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');
const freeTempDir = path.join(freeOutputDir, 'tmp');

// Wan2.2 Animate-2-14B: reference image + driving video.
const VIDEO_SPACE = process.env.WAN_FREE_SPACE || 'hugging-apps/wan2-2-animate-2-14b';
const VIDEO_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/animate';
const WAN_MOTION_TEMPLATE = process.env.WAN_MOTION_TEMPLATE || 'https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/examples/wan_animate/animate/video.mp4';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

function pickVideoValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickVideoValue(item);
      if (picked) return picked;
    }
    return '';
  }
  if (typeof value === 'object') return value.url || value.path || value.video?.url || value.video?.path || '';
  return '';
}

function describeError(error) {
  const message = error?.message || String(error || 'Error desconocido');
  const cause = error?.cause?.message ? ` (${error.cause.message})` : '';
  return `${message}${cause}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible en el servidor.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-800)}`)));
  });
}

async function saveVideoResult(value) {
  const videoValue = pickVideoValue(value);
  if (!videoValue) throw new Error('Wan2.2 terminó sin devolver el vídeo generado.');
  await fs.mkdir(freeOutputDir, { recursive: true });
  await fs.mkdir(freeTempDir, { recursive: true });
  const filename = `wan22-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const rawDestination = path.join(freeTempDir, filename);
  const destination = path.join(freeOutputDir, filename);
  if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    await fs.writeFile(rawDestination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, rawDestination);
  }
  // 2 seconds of AI motion, then a continuous 5-second final clip.
  await runFfmpeg(['-y', '-i', rawDestination, '-vf', 'setpts=2.5*PTS', '-t', '5', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination]);
  await fs.rm(rawDestination, { force: true }).catch(() => {});
  return `/free-image-video/${filename}`;
}

function parsePrompt(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (parsed && typeof parsed === 'object') return { motion: String(parsed.motion || '').trim() };
  } catch {}
  return { motion: String(value || '').trim() };
}

export async function generateFreeWanImageVideo({ imagePath, prompt }) {
  try {
    if (!HF_TOKEN) throw new Error('Hugging Face requiere autenticación. Configura HF_TOKEN en Render con un token personal de Hugging Face (permiso Read).');
    const request = parsePrompt(prompt);
    const app = await Client.connect(VIDEO_SPACE, { token: HF_TOKEN });
    const api = await app.view_api();
    if (!api?.named_endpoints?.[VIDEO_ENDPOINT]) {
      const available = Object.keys(api?.named_endpoints || {}).join(', ');
      throw new Error(`El Space ${VIDEO_SPACE} no expone ${VIDEO_ENDPOINT}. Endpoints: ${available || 'ninguno'}.`);
    }
    const referenceImage = handle_file(imagePath);
    const drivingVideo = handle_file(WAN_MOTION_TEMPLATE);
    const animationPrompt = [
      'Photorealistic adult person animation.',
      'Preserve the exact person shown in the reference image, including face, hair, clothing, body proportions and scene.',
      'Do not create a different person, change clothing, redesign the body or change the background.',
      'Very subtle natural motion only: gentle breathing, realistic blinking when a face is visible, and a tiny natural head movement when appropriate.',
      'Stable identity, realistic anatomy, no morphing, no duplicate person, no face distortion, no camera movement.',
      request.motion
    ].filter(Boolean).join(' ');
    const result = await app.predict(VIDEO_ENDPOINT, [
      referenceImage,
      drivingVideo,
      animationPrompt.slice(0, 4000),
      2,
      480,
      384,
      6,
      1,
      2,
      'distorted face, identity drift, morphing, extra people, duplicate body parts, deformed hands, cartoon, CGI, low resolution, blurry, pixelated, text, watermark',
      0
    ]);
    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickVideoValue(item)) || data[0];
    const outputUrl = await saveVideoResult(output);
    return {
      outputUrl,
      provider: `Wan2.2 Animate (${VIDEO_SPACE})`,
      detail: 'Prueba con Wan2.2 Animate-2-14B: 2 s de movimiento IA y salida final continua de 5 s.'
    };
  } catch (error) {
    throw new Error(`Wan2.2 no pudo generar el vídeo: ${describeError(error)}`);
  }
}
