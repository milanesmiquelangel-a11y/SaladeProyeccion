import { EdgeTTS } from 'node-edge-tts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(__dirname, '..', 'public');
const narrationDir = path.join(publicDir, 'narration');

const VOICES = {
  en: 'en-US-AriaNeural',
  es: 'es-ES-ElviraNeural',
  ru: 'ru-RU-SvetlanaNeural',
  kk: 'kk-KZ-AigulNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  tr: 'tr-TR-EmelNeural',
  ar: 'ar-SA-ZariyahNeural',
  hi: 'hi-IN-SwaraNeural',
  pl: 'pl-PL-ZofiaNeural',
  uk: 'uk-UA-PolinaNeural',
  nl: 'nl-NL-ColetteNeural'
};

const LANGS = {
  en: 'en-US', es: 'es-ES', ru: 'ru-RU', kk: 'kk-KZ', fr: 'fr-FR', de: 'de-DE',
  it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', 'zh-CN': 'zh-CN', tr: 'tr-TR',
  ar: 'ar-SA', hi: 'hi-IN', pl: 'pl-PL', uk: 'uk-UA', nl: 'nl-NL'
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible para añadir la narración.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-900)}`)));
  });
}

function safeLanguage(value) {
  const key = String(value || 'en').trim();
  return VOICES[key] ? key : 'en';
}

export async function generateNarration({ text, language = 'en' }) {
  const cleanText = String(text || '').trim().slice(0, 4000);
  if (!cleanText) return null;

  const lang = safeLanguage(language);
  await fs.mkdir(narrationDir, { recursive: true });
  const filename = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
  const audioPath = path.join(narrationDir, filename);
  const tts = new EdgeTTS({
    voice: VOICES[lang],
    lang: LANGS[lang],
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    rate: '0%',
    pitch: '0Hz',
    volume: '0%'
  });
  await tts.ttsPromise(cleanText, audioPath);
  return audioPath;
}

export async function muxNarration(videoPath, audioPath) {
  if (!audioPath) return videoPath;
  const outputPath = videoPath.replace(/\.mp4$/i, '-audio.mp4');
  await runFfmpeg([
    '-y', '-i', videoPath, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-t', '5',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath
  ]);
  await fs.rm(videoPath, { force: true }).catch(() => {});
  await fs.rm(audioPath, { force: true }).catch(() => {});
  await fs.rename(outputPath, videoPath);
  return videoPath;
}
