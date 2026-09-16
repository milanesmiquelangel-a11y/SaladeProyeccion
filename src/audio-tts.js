import { EdgeTTS } from 'node-edge-tts';
import { getAllAudioBase64 } from '@sefinek/google-tts-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const LANGUAGE_ALIASES = {
  auto: 'en-US', en: 'en-US', es: 'es-ES', ru: 'ru-RU', kk: 'kk-KZ', fr: 'fr-FR', de: 'de-DE',
  it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', 'zh-cn': 'zh-CN', zh: 'zh-CN', tr: 'tr-TR',
  ar: 'ar-SA', hi: 'hi-IN', pl: 'pl-PL', uk: 'uk-UA', nl: 'nl-NL'
};
const VOICES = {
  'en-US': 'en-US-EmmaMultilingualNeural', 'es-ES': 'es-ES-ElviraNeural', 'ru-RU': 'ru-RU-SvetlanaNeural',
  'kk-KZ': 'kk-KZ-AigulNeural', 'fr-FR': 'fr-FR-DeniseNeural', 'de-DE': 'de-DE-KatjaNeural',
  'it-IT': 'it-IT-ElsaNeural', 'pt-BR': 'pt-BR-FranciscaNeural', 'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural', 'zh-CN': 'zh-CN-XiaoxiaoNeural', 'tr-TR': 'tr-TR-EmelNeural',
  'ar-SA': 'ar-SA-ZariyahNeural', 'hi-IN': 'hi-IN-SwaraNeural', 'pl-PL': 'pl-PL-AgnieszkaNeural',
  'uk-UA': 'uk-UA-PolinaNeural', 'nl-NL': 'nl-NL-ColetteNeural'
};

export function normalizeAudioLanguage(value) {
  const raw = String(value || 'en').trim().toLowerCase();
  return LANGUAGE_ALIASES[raw] || (raw.includes('-') ? raw : 'en-US');
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

async function edgeSpeech(text, voice, output) {
  const tts = new EdgeTTS({ voice, lang: voice.slice(0, 5), outputFormat: 'audio-24khz-96kbitrate-mono-mp3' });
  await tts.ttsPromise(text, output);
  const stat = await fs.stat(output).catch(() => null);
  if (!stat?.size) throw new Error('Edge TTS no devolvió un archivo de audio.');
}

async function googleFallback(text, language, output) {
  const parts = await getAllAudioBase64(text, {
    lang: normalizeAudioLanguage(language).split('-')[0], slow: false,
    host: 'https://translate.google.com', timeout: 15000, splitPunct: ',.?!;:،。！？；：'
  });
  if (!Array.isArray(parts) || !parts.length) throw new Error('El respaldo Google TTS no devolvió audio.');
  const work = path.join(path.dirname(output), `google-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const files = [];
    for (let i = 0; i < parts.length; i += 1) {
      const file = path.join(work, `part-${String(i).padStart(3, '0')}.mp3`);
      await fs.writeFile(file, Buffer.from(parts[i].base64, 'base64'));
      files.push(file);
    }
    if (files.length === 1) await fs.copyFile(files[0], output);
    else {
      const list = path.join(work, 'concat.txt');
      await fs.writeFile(list, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', output]);
    }
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => {}); }
}

export async function generateSpeechAudio({ text, language = 'en', outputDir }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('El texto de voz está vacío.');
  if (cleanText.length > 4000) throw new Error('El texto de voz no puede superar 4000 caracteres.');
  const dir = outputDir || path.join(process.cwd(), 'public', 'generated-audio');
  await fs.mkdir(dir, { recursive: true });
  const locale = normalizeAudioLanguage(language);
  const voice = VOICES[locale] || VOICES['en-US'];
  const output = path.join(dir, `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    await edgeSpeech(cleanText, voice, output);
    return output;
  } catch (edgeError) {
    console.warn(`[TTS] Edge TTS falló para ${locale}; usando respaldo:`, edgeError?.message || edgeError);
    try {
      await googleFallback(cleanText, locale, output);
      return output;
    } catch (fallbackError) {
      await fs.rm(output, { force: true }).catch(() => {});
      throw new Error(`No se pudo generar la narración en ${locale}: ${fallbackError?.message || edgeError?.message || 'error de TTS'}`);
    }
  }
}

export async function muxAudioIntoVideo({ videoPath, audioPath, outputPath, durationSeconds = 5 }) {
  const duration = Math.max(1, Number(durationSeconds) || 5);
  await runFfmpeg(['-y', '-i', videoPath, '-stream_loop', '-1', '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-t', String(duration), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath]);
  await runFfmpeg(['-v', 'error', '-i', outputPath, '-map', '0:a:0', '-f', 'null', '-']);
}
