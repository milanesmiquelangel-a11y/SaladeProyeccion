import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { generateSpeechAudio as generateGoogleSpeechAudio, muxAudioIntoVideo } from './audio-tts.js';

const MELO_COMMAND = process.env.MELO_COMMAND || 'melo';
const MELO_TIMEOUT_MS = Number(process.env.MELO_TIMEOUT_MS || 120000);

const MELO_LANGUAGES = {
  en: { language: 'EN', speaker: process.env.MELO_EN_SPEAKER || 'EN-US' },
  es: { language: 'ES', speaker: process.env.MELO_ES_SPEAKER || 'ES' },
  fr: { language: 'FR', speaker: process.env.MELO_FR_SPEAKER || 'FR' },
  zh: { language: 'ZH', speaker: process.env.MELO_ZH_SPEAKER || 'ZH' },
  'zh-cn': { language: 'ZH', speaker: process.env.MELO_ZH_SPEAKER || 'ZH' },
  ja: { language: 'JP', speaker: process.env.MELO_JP_SPEAKER || 'JP' },
  ko: { language: 'KR', speaker: process.env.MELO_KR_SPEAKER || 'KR' }
};

function normalizeLanguage(value) {
  const raw = String(value || 'en').trim().toLowerCase();
  if (raw === 'auto') return 'en';
  if (raw.startsWith('zh')) return 'zh';
  return raw.split('-')[0];
}

function runMelo(text, language, outputPath) {
  return new Promise((resolve, reject) => {
    const config = MELO_LANGUAGES[language];
    if (!config) return reject(Object.assign(new Error(`MeloTTS no tiene un modelo configurado para ${language}.`), { code: 'MELO_UNSUPPORTED_LANGUAGE' }));

    const args = [text, outputPath, '--language', config.language, '--speaker', config.speaker];
    const child = spawn(MELO_COMMAND, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(Object.assign(new Error('MeloTTS tardó demasiado en generar el audio.'), { code: 'MELO_TIMEOUT' }));
    }, MELO_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(error, { code: error.code || 'MELO_SPAWN_ERROR' }));
    });
    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error(`MeloTTS terminó con código ${code}: ${(stderr || stdout).slice(-600)}`), { code: 'MELO_FAILED' }));
        return;
      }
      try {
        const stat = await fs.stat(outputPath);
        if (!stat.size) throw new Error('MeloTTS terminó sin crear un archivo de audio.');
        resolve(outputPath);
      } catch (error) {
        reject(Object.assign(error, { code: 'MELO_NO_OUTPUT' }));
      }
    });
  });
}

export async function generateSpeech({ text, language = 'en', outputDir }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('El texto de voz está vacío.');
  if (cleanText.length > 4000) throw new Error('El texto de voz no puede superar 4000 caracteres.');

  const lang = normalizeLanguage(language);
  const dir = outputDir || path.join(process.cwd(), 'public', 'generated-audio');
  await fs.mkdir(dir, { recursive: true });

  if (MELO_LANGUAGES[lang]) {
    const outputPath = path.join(dir, `melo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
    try {
      await runMelo(cleanText, lang, outputPath);
      return { filePath: outputPath, provider: 'MeloTTS', language: lang, fallback: false };
    } catch (error) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
      console.warn(`MeloTTS no disponible (${error.code || 'unknown'}). Se usará el proveedor de respaldo.`);
    }
  }

  const fallback = await generateGoogleSpeechAudio({ text: cleanText, language: lang, outputDir: dir });
  return { filePath: fallback, provider: 'Google TTS fallback', language: lang, fallback: true };
}

export { muxAudioIntoVideo };
export { normalizeLanguage };
