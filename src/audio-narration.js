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
  en: 'en',
  es: 'es',
  ru: 'ru',
  kk: 'kk',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  ja: 'ja',
  ko: 'ko',
  'zh-CN': 'zh-CN',
  tr: 'tr',
  ar: 'ar',
  hi: 'hi',
  pl: 'pl',
  uk: 'uk',
  nl: 'nl'
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible para montar el audio.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'voice';
}

export async function addNarrationToVideo({ videoFilePath, videoPublicUrl, text, language = 'en' }) {
  const narration = String(text || '').trim();
  if (!narration) return { outputUrl: videoPublicUrl, audioAdded: false };

  const lang = LANGUAGE_MAP[language] || 'en';
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });

  const jobId = `${Date.now()}-${safeName(language)}-${Math.random().toString(36).slice(2, 8)}`;
  const parts = [];
  const files = [];

  try {
    const chunks = await googleTTS.getAllAudioBase64(narration, {
      lang,
      slow: false,
      timeout: 15000,
      splitPunct: ',.?!;:،。！？；：\n'
    });

    if (!chunks?.length) throw new Error('El servicio de voz no devolvió audio.');

    for (let index = 0; index < chunks.length; index += 1) {
      const file = path.join(tempDir, `${jobId}-${index}.mp3`);
      await fs.writeFile(file, Buffer.from(chunks[index].base64, 'base64'));
      parts.push(`file '${file.replace(/'/g, "'\\''")}'`);
      files.push(file);
    }

    const concatFile = path.join(tempDir, `${jobId}-concat.txt`);
    const audioFile = path.join(tempDir, `${jobId}.mp3`);
    const finalName = `video-${jobId}.mp4`;
    const finalFile = path.join(audioDir, finalName);
    const finalUrl = `/generated-audio/${finalName}`;

    await fs.writeFile(concatFile, `${parts.join('\n')}\n`, 'utf8');
    await runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-c:a', 'libmp3lame', '-b:a', '128k', audioFile
    ]);

    // Keep the requested 5-second video duration. If the narration is longer,
    // the voice is trimmed so the final MP4 remains a 5-second production.
    await runFfmpeg([
      '-y', '-i', videoFilePath, '-i', audioFile,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-t', '5', '-shortest', '-movflags', '+faststart', finalFile
    ]);

    return {
      outputUrl: finalUrl,
      audioAdded: true,
      audioLanguage: lang,
      detail: `Vídeo generado con narración en ${lang}.`
    };
  } finally {
    await Promise.all(files.map((file) => fs.rm(file, { force: true }).catch(() => {})));
    await fs.rm(path.join(tempDir, `${jobId}-concat.txt`), { force: true }).catch(() => {});
    await fs.rm(path.join(tempDir, `${jobId}.mp3`), { force: true }).catch(() => {});
  }
}
