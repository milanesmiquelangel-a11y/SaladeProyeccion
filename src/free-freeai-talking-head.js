import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const outputDir = path.join(publicDir, 'free-image-video');
const API_KEY = process.env.FREEAI_API_KEY || '';
const ENDPOINT = process.env.FREEAI_TALKING_HEAD_ENDPOINT || 'https://api.free.ai/v1/video/talking-head/';
const FINAL_SECONDS = 5;

function requireApiKey() {
  if (!API_KEY) {
    throw new Error('FREEAI_API_KEY no está configurada en Render. Añade la clave gratuita de Free.ai para activar Talking Photo sin ZeroGPU.');
  }
}

async function normalizeFiveSeconds(inputPath, outputPath) {
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-y', '-i', inputPath,
    '-t', String(FINAL_SECONDS),
    '-vf', 'fps=25,scale=720:-2:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-an', outputPath,
  ]);
}

async function downloadVideo(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Free.ai devolvió el vídeo pero no pudo descargarse (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Free.ai devolvió un vídeo vacío.');
  await fs.writeFile(targetPath, buffer);
}

export async function generateFreeAITalkingHead({ imagePath, audioPath }) {
  requireApiKey();
  await fs.mkdir(outputDir, { recursive: true });

  const image = await fs.readFile(imagePath);
  const audio = await fs.readFile(audioPath);
  const form = new FormData();
  form.append('image', new Blob([image], { type: 'image/jpeg' }), path.basename(imagePath));
  form.append('audio', new Blob([audio], { type: 'audio/mpeg' }), path.basename(audioPath));

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || data?.detail;
    throw new Error(message ? `Free.ai rechazó la generación: ${message}` : `Free.ai rechazó la generación (HTTP ${response.status}).`);
  }

  const rawUrl = data.video_url || data.videoUrl || data.output?.video_url || data.output?.url || data.url;
  if (!rawUrl) throw new Error('Free.ai no devolvió video_url en la respuesta.');

  const rawPath = path.join(outputDir, `${randomUUID()}-raw.mp4`);
  const finalName = `${randomUUID()}.mp4`;
  const finalPath = path.join(outputDir, finalName);
  try {
    await downloadVideo(rawUrl, rawPath);
    await normalizeFiveSeconds(rawPath, finalPath);
  } finally {
    await fs.rm(rawPath, { force: true }).catch(() => {});
  }

  return {
    outputUrl: `/free-image-video/${finalName}`,
    detail: 'Vídeo hablado de 5 s generado con Free.ai/SadTalker, sin ZeroGPU de Hugging Face.',
  };
}
