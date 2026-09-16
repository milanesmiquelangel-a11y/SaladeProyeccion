import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateSpeech } from './audio-service.js';
import { attachGeneratedAudio } from './patch-audio-mux.js';

const publicDir = path.join(process.cwd(), 'public');
const audioDir = path.join(publicDir, 'generated-audio');
const generatedDir = path.join(publicDir, 'generated');

function audioJobKey(key) {
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || randomUUID();
}

export async function generateAndAttachAudio({ videoUrl, text, language = 'en', durationSeconds = 5 }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('El texto de voz está vacío.');
  if (cleanText.length > 4000) throw new Error('El texto de voz no puede superar 4000 caracteres.');
  if (!videoUrl) throw new Error('Falta el vídeo al que se añadirá el audio.');

  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  const audio = await generateSpeech({ text: cleanText, language, outputDir: audioDir });
  const audioName = path.basename(audio.filePath);
  const sourceName = `natural-audio-source-${audioJobKey(Date.now())}.mp4`;
  const outputName = `natural-audio-${audioJobKey(Date.now())}.mp4`;
  const sourcePath = path.join(generatedDir, sourceName);
  const outputPath = path.join(generatedDir, outputName);

  try {
    const parsed = new URL(String(videoUrl));
    if (parsed.protocol !== 'https:') throw new Error('El vídeo remoto debe utilizar HTTPS.');
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === '169.254.169.254') {
      throw new Error('La dirección del vídeo remoto no está permitida.');
    }
    const response = await fetch(parsed.toString(), { redirect: 'follow' });
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo para añadir el audio (HTTP ${response.status}).`);
    await fs.writeFile(sourcePath, Buffer.from(await response.arrayBuffer()));

    await attachGeneratedAudio({
      videoPath: sourcePath,
      audioPath: audio.filePath,
      outputPath,
      durationSeconds: Math.max(1, Number(durationSeconds) || 5)
    });
    return { url: `/generated/${outputName}`, provider: audio.provider, language: audio.language, fallback: audio.fallback };
  } finally {
    await fs.rm(sourcePath, { force: true }).catch(() => {});
  }
}
