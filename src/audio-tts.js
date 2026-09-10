import { getAllAudioBase64 } from '@sefinek/google-tts-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible en el servidor.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-600)}`));
    });
  });
}

const LANGUAGE_ALIASES = {
  auto: 'en', en: 'en', es: 'es', ru: 'ru', kk: 'kk', fr: 'fr', de: 'de', it: 'it', pt: 'pt',
  ja: 'ja', ko: 'ko', zh: 'zh-CN', tr: 'tr', ar: 'ar', hi: 'hi', pl: 'pl', uk: 'uk', nl: 'nl'
};

export function normalizeAudioLanguage(value) {
  const key = String(value || 'en').trim().toLowerCase();
  return LANGUAGE_ALIASES[key] || 'en';
}

export async function generateSpeechAudio({ text, language = 'en', outputDir }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('El texto de voz está vacío.');
  if (cleanText.length > 4000) throw new Error('El texto de voz no puede superar 4000 caracteres.');

  const dir = outputDir || path.join(process.cwd(), 'public', 'generated-audio');
  await fs.mkdir(dir, { recursive: true });
  const workDir = path.join(dir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const parts = await getAllAudioBase64(cleanText, {
      lang: normalizeAudioLanguage(language),
      slow: false,
      host: 'https://translate.google.com',
      timeout: 15000,
      splitPunct: ',.?!;:،。！？；：'
    });
    if (!Array.isArray(parts) || !parts.length) throw new Error('El servicio de voz no devolvió audio.');

    const files = [];
    for (let i = 0; i < parts.length; i += 1) {
      const file = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp3`);
      await fs.writeFile(file, Buffer.from(parts[i].base64, 'base64'));
      files.push(file);
    }

    const listFile = path.join(workDir, 'concat.txt');
    await fs.writeFile(listFile, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
    const output = path.join(dir, `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    if (files.length === 1) await fs.copyFile(files[0], output);
    else await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output]);
    return output;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function muxAudioIntoVideo({ videoPath, audioPath, outputPath, durationSeconds = 5 }) {
  await runFfmpeg([
    '-y', '-i', videoPath, '-stream_loop', '-1', '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-t', String(Math.max(1, Number(durationSeconds) || 5)),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest',
    '-movflags', '+faststart', outputPath
  ]);
}
