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

const WAN_SPACE = process.env.WAN_FREE_SPACE || 'hugging-apps/wan2-2-animate-2-14b';
const WAN_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/animate';
const WAN_MOTION_TEMPLATE = process.env.WAN_MOTION_TEMPLATE ||
  'https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/examples/wan_animate/animate/video.mp4';
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
  if (typeof value === 'object') {
    return value.url || value.path || value.video?.url || value.video?.path || '';
  }
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
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-800)}`));
    });
  });
}

async function normalizeReferenceImage(imagePath) {
  await fs.mkdir(freeTempDir, { recursive: true });
  const output = path.join(freeTempDir, `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);

  await runFfmpeg([
    '-y', '-loop', '1', '-i', imagePath,
    '-frames:v', '1',
    '-filter_complex',
    '[0:v]scale=640:360:force_original_aspect_ratio=increase,crop=640:360,gblur=sigma=18[bg];' +
    '[0:v]scale=640:360:force_original_aspect_ratio=decrease[fg];' +
    '[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[out]',
    '-map', '[out]',
    '-q:v', '2',
    output
  ]);

  return output;
}

async function saveVideoResult(value) {
  const videoValue = pickVideoValue(value);
  if (!videoValue) throw new Error('Wan2.2 terminó sin devolver el vídeo generado.');

  await fs.mkdir(freeOutputDir, { recursive: true });
  const filename = `wan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const rawDestination = path.join(freeTempDir, filename);
  const destination = path.join(freeOutputDir, filename);

  await fs.mkdir(freeTempDir, { recursive: true });

  if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    await fs.writeFile(rawDestination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, rawDestination);
  }

  await runFfmpeg([
    '-y', '-i', rawDestination,
    '-vf', 'setpts=1.4705882353*PTS',
    '-t', '5',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    destination
  ]);

  await fs.rm(rawDestination, { force: true }).catch(() => {});
  return `/free-image-video/${filename}`;
}

export async function generateFreeWanImageVideo({ imagePath, prompt }) {
  let normalizedImagePath = '';
  try {
    if (!HF_TOKEN) {
      throw new Error('Hugging Face requiere autenticación para usar la cuota ZeroGPU. Configura HF_TOKEN en Render con un token personal de Hugging Face (permiso Read).');
    }

    const app = await Client.connect(WAN_SPACE, { token: HF_TOKEN });
    const api = await app.view_api();
    const endpointInfo = api?.named_endpoints?.[WAN_ENDPOINT];
    if (!endpointInfo) {
      throw new Error(`El Space ${WAN_SPACE} no expone actualmente ${WAN_ENDPOINT}.`);
    }

    normalizedImagePath = await normalizeReferenceImage(imagePath);
    const referenceImage = handle_file(normalizedImagePath);
    const drivingVideo = handle_file(WAN_MOTION_TEMPLATE);

    const animationPrompt = [
      'Photorealistic adult person animation.',
      'Use the reference image as the primary source for the person, clothing, body proportions and scene.',
      'Preserve the visible appearance and composition of the reference; do not invent a new person or redesign the clothing.',
      'Very subtle natural movement only: gentle breathing, realistic blinking when a face is visible, and a small natural head movement when a head is visible.',
      'Stable appearance throughout the clip, realistic anatomy, no morphing, no duplicate person, no face distortion, no camera movement.',
      String(prompt || '').trim()
    ].filter(Boolean).join(' ');

    // One 3.4-second / 81-frame segment avoids the expensive second segment.
    // 320x480 and 5 steps keep the xlarge ZeroGPU reservation near 93 seconds,
    // far below the previous ~218-second request. The generated segment is
    // stretched to the app's exact 5-second output after inference.
    const result = await app.predict(WAN_ENDPOINT, [
      referenceImage,
      drivingVideo,
      animationPrompt.slice(0, 4000),
      3.4,
      320,
      480,
      5,
      1,
      5,
      'distorted face, identity drift, morphing, extra people, duplicate body parts, deformed hands, cartoon, CGI, low resolution, blurry, pixelated',
      0
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickVideoValue(item)) || data[0];
    const outputUrl = await saveVideoResult(output);

    return {
      outputUrl,
      provider: `Wan2.2 Animate (${WAN_SPACE})`,
      detail: 'Vídeo generado con Wan2.2 Animate-2-14B mediante una referencia 16:9 normalizada y un segmento de movimiento de 3,4 s convertido a un clip final de 5 s.'
    };
  } catch (error) {
    throw new Error(`Wan2.2 no pudo generar el vídeo: ${describeError(error)}`);
  } finally {
    if (normalizedImagePath) await fs.rm(normalizedImagePath, { force: true }).catch(() => {});
  }
}
