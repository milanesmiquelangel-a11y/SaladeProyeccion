import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const outputDir = path.join(publicDir, 'free-image-video');
const API_KEY = String(process.env.FREEAI_API_KEY || '').trim();
const ENDPOINT = process.env.FREEAI_TALKING_HEAD_ENDPOINT || 'https://api.free.ai/v1/video/talking-head/';
const FINAL_SECONDS = 5;

function requireApiKey() {
  if (!API_KEY) {
    throw new Error('FREEAI_API_KEY no está configurada en Render. Añade la clave de Free.ai como secreto.');
  }
}

async function runFfmpeg(args) {
  const binary = process.env.FFMPEG_PATH || ffmpegPath;
  if (!binary) throw new Error('FFmpeg no está disponible en el servidor.');
  try {
    await execFileAsync(binary, args, { maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).slice(-1500) : '';
    throw new Error(`FFmpeg no pudo procesar el vídeo${stderr ? `: ${stderr}` : `: ${error.message || 'error desconocido'}`}`);
  }
}

async function normalizeFiveSeconds(inputPath, outputPath) {
  await runFfmpeg([
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

function pickVideoUrl(data) {
  return data?.video_url || data?.videoUrl || data?.output?.video_url || data?.output?.url || data?.output?.video || data?.url || '';
}

export async function generateFreeAITalkingHead({ imagePath, audioPath }) {
  requireApiKey();
  if (!imagePath) throw new Error('No se encontró la fotografía.');
  if (!audioPath) throw new Error('No se encontró el audio.');
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

  const rawUrl = pickVideoUrl(data);
  if (!rawUrl) throw new Error(`Free.ai no devolvió una URL de vídeo. Respuesta: ${JSON.stringify(data).slice(0, 1200)}`);

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
    detail: 'Vídeo hablado de 5 s generado con Free.ai, sin ZeroGPU de Hugging Face.',
  };
}
