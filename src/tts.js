import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const audioDir = path.join(publicDir, 'generated-audio');
const LANGUAGES = new Set(['en','es','ru','kk','fr','de','it','pt','ja','ko','zh-CN','tr','ar','hi','pl','uk','nl']);

function splitText(text, max = 180) {
  const words = String(text).trim().split(/\s+/); const parts = []; let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) { parts.push(current); current = word; } else current = next;
  }
  if (current) parts.push(current); return parts;
}

async function fetchSpeech(text, language) {
  const url = new URL('https://translate.google.com/translate_tts');
  url.searchParams.set('ie','UTF-8'); url.searchParams.set('client','tw-ob');
  url.searchParams.set('tl',language); url.searchParams.set('q',text);
  const response = await fetch(url, { headers: { 'User-Agent':'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`El servicio de voz respondió HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

export async function generateNarration(text, language = 'en') {
  const clean = String(text || '').trim().slice(0, 4000); if (!clean) return null;
  const lang = LANGUAGES.has(language) ? language : 'en';
  await fs.mkdir(audioDir, { recursive: true });
  const audio = [];
  for (const part of splitText(clean)) audio.push(await fetchSpeech(part, lang));
  const filename = `narration-${Date.now()}-${Math.random().toString(36).slice(2,8)}.mp3`;
  const filePath = path.join(audioDir, filename); await fs.writeFile(filePath, Buffer.concat(audio));
  return { filePath, url:`/generated-audio/${filename}`, language:lang };
}
