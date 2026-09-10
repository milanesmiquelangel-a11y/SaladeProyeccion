import * as googleTTS from '@sefinek/google-tts-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(__dirname, '..', 'public');
const audioDir = path.join(publicDir, 'generated-audio');
const tempDir = path.join(audioDir, 'tmp');

const LANGUAGE_MAP = {
  en: 'en', es: 'es', ru: 'ru', kk: 'kk', fr: 'fr', de: 'de', it: 'it',
  pt: 'pt', ja: 'ja', ko: 'ko', 'zh-CN': 'zh-CN', tr: 'tr', ar: 'ar', hi: 'hi',
  pl: 'pl', uk: 'uk', nl: 'nl'
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible en el servidor.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg de audio terminó con código ${code}: ${stderr.slice(-600)}`)));
  });
}

async function writeAudioParts(text, language) {
  await fs.mkdir(tempDir, { recursive: true });
  const parts = await googleTTS.getAllAudioBase64(text, {
    lang: language,
    slow: false,
    host: 'https://translate.google.com',
    timeout: 15000,
    splitPunct: ',.!?;:\n'
  });
  if (!Array.isArray(parts) || !parts.length) throw new Error('El servicio de voz no devolvió audio.');

  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const file = path.join(tempDir, `tts-${Date.now()}-${i}.mp3`);
    await fs.writeFile(file, Buffer.from(parts[i].base64, 'base64'));
    files.push(file);
  }
  return files;
}

export async function generateNarration(text, language = 'en') {
  const cleanText = String(text || '').trim();
  if (!cleanText) return null;
  if (cleanText.length > 4000) throw new Error('El texto de narración no puede superar 4000 caracteres.');

  const lang = LANGUAGE_MAP[String(language)] || 'en';
  const files = await writeAudioParts(cleanText, lang);
  const output = path.join(audioDir, `narration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);

  try {
    if (files.length === 1) {
      await fs.rename(files[0], output);
    } else {
      const concatFile = path.join(tempDir, `concat-${Date.now()}.txt`);
      const manifest = files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n');
      await fs.writeFile(concatFile, `${manifest}\n`, 'utf8');
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', output]);
      await fs.rm(concatFile, { force: true });
    }
    return output;
  } finally {
    await Promise.all(files.map((file) => fs.rm(file, { force: true }).catch(() => {})));
  }
}

export async function muxNarrationIntoVideo(videoPath, audioPath, outputPath) {
  await runFfmpeg([
    '-y', '-i', videoPath, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart', outputPath
  ]);
  return outputPath;
}

export async function cleanupNarration(audioPath) {
  if (audioPath) await fs.rm(audioPath, { force: true }).catch(() => {});
}
