import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');
const freeTempDir = path.join(publicDir, 'free-image-video', 'tmp');

const LIVEPORTRAIT_SPACE = process.env.LIVEPORTRAIT_SPACE || 'KlingTeam/LivePortrait';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();
const DEFAULT_DRIVING_URL = 'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/driving/d0.mp4?download=true';
const DRIVING_VIDEO = String(process.env.LIVEPORTRAIT_DRIVING_VIDEO || '').trim();

function pickVideoValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickVideoValue(item);
      if (picked) return picked;
    }
  }
  if (typeof value === 'object') return value.url || value.path || value.video?.url || value.video?.path || '';
  return '';
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

async function normalizeOutput(value) {
  const videoValue = pickVideoValue(value);
  if (!videoValue) throw new Error('LivePortrait terminó sin devolver un vídeo.');
  await fs.mkdir(freeOutputDir, { recursive: true });
  await fs.mkdir(freeTempDir, { recursive: true });
  const name = `liveportrait-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const raw = path.join(freeTempDir, name);
  const destination = path.join(freeOutputDir, name);
  if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el resultado de LivePortrait (HTTP ${response.status}).`);
    await fs.writeFile(raw, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, raw);
  }
  await runFfmpeg([
    '-y', '-i', raw,
    '-t', '5', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination
  ]);
  await fs.rm(raw, { force: true }).catch(() => {});
  return `/free-image-video/${name}`;
}

async function resolveDrivingVideo() {
  if (DRIVING_VIDEO) return DRIVING_VIDEO;
  const local = path.join(publicDir, 'assets', 'idle-motion.mp4');
  try {
    await fs.access(local);
    return local;
  } catch {
    // Until the dedicated idle-motion asset is committed, use the official
    // LivePortrait demo driver as a safe fallback. It is head-focused and
    // intended for portrait animation.
    return DEFAULT_DRIVING_URL;
  }
}

function findAnimationEndpoint(api) {
  const endpoints = api?.named_endpoints || {};
  const preferred = ['/gpu_wrapped_execute_video', '/execute_video', '/animate'];
  for (const name of preferred) if (endpoints[name]) return name;
  const candidate = Object.entries(endpoints).find(([name, info]) => {
    const text = `${name} ${JSON.stringify(info)}`.toLowerCase();
    return text.includes('execute_video') || text.includes('portrait animation') || text.includes('driving video');
  });
  if (candidate) return candidate[0];
  throw new Error('El Space de LivePortrait no expone un endpoint de animación compatible.');
}

export async function generateLivePortraitVideo({ imagePath }) {
  if (!HF_TOKEN) throw new Error('Hugging Face requiere HF_TOKEN para LivePortrait.');

  const app = await Client.connect(LIVEPORTRAIT_SPACE, { token: HF_TOKEN });
  const api = await app.view_api();
  const endpoint = findAnimationEndpoint(api);
  const driver = await resolveDrivingVideo();

  const result = await app.predict(endpoint, [
    handle_file(imagePath),
    handle_file(driver),
    true,
    true,
    true,
    false
  ]);

  const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
  const output = data.find((item) => pickVideoValue(item)) || data[0];
  const outputUrl = await normalizeOutput(output);

  return {
    outputUrl,
    provider: `LivePortrait (${LIVEPORTRAIT_SPACE})`,
    detail: 'Vídeo generado con LivePortrait usando un vídeo conductor de movimiento facial suave.'
  };
}
