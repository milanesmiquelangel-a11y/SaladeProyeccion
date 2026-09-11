import * as googleTTS from '@sefinek/google-tts-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, '..', 'public', 'free-image-video', 'tmp');

const LANGUAGE_ALIASES = {
  en: 'en', es: 'es', ru: 'ru', kk: 'kk', fr: 'fr', de: 'de', it: 'it', pt: 'pt',
  ja: 'ja', ko: 'ko', 'zh-CN': 'zh-CN', tr: 'tr', ar: 'ar', hi: 'hi', pl: 'pl',
  uk: 'uk', nl: 'nl'
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible en el servidor.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg de audio terminó con código ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function normalizeLanguage(language) {
  const raw = String(language || 'en').trim();
  return LANGUAGE_ALIASES[raw] || raw.split('-')[0] || 'en';
}

export async function generateNarrationAudio({ text, language = 'en' }) {
  const narration = String(text || '').trim();
  if (!narration) return null;
  if (narration.length > 4000) throw new Error('La narración no puede superar 4000 caracteres.');

  await fs.mkdir(tempDir, { recursive: true });
  const safeLanguage = normalizeLanguage(language);
  const chunks = await googleTTS.getAllAudioBase64(narration, {
    lang: safeLanguage,
    slow: false,
    host: 'https://translate.google.com',
    timeout: 15000,
    splitPunct: ',.?!;:\n'
  });
  if (!Array.isArray(chunks) || !chunks.length) throw new Error('El servicio de voz no devolvió audio.');

  const prefix = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const partPaths = [];
  const listPath = path.join(tempDir, `${prefix}.txt`);
  const outputPath = path.join(tempDir, `${prefix}.mp3`);

  try {
    for (let i = 0; i < chunks.length; i += 1) {
      const partPath = path.join(tempDir, `${prefix}-${i}.mp3`);
      await fs.writeFile(partPath, Buffer.from(chunks[i].base64, 'base64'));
      partPaths.push(partPath);
    }
    await fs.writeFile(listPath, partPaths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
    if (partPaths.length === 1) {
      await fs.copyFile(partPaths[0], outputPath);
    } else {
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
    }
    return { path: outputPath, language: safeLanguage, characters: narration.length };
  } finally {
    await Promise.all(partPaths.map((file) => fs.rm(file, { force: true }).catch(() => {})));
    await fs.rm(listPath, { force: true }).catch(() => {});
  }
}
