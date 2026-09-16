import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@gradio/client';

const AUDIO_SPACE = String(process.env.NATURAL_AUDIO_SPACE || 'stabilityai/stable-audio-3').trim();
const HF_TOKEN = String(process.env.HF_TOKEN || '').trim() || undefined;
const TIMEOUT_MS = Number(process.env.NATURAL_AUDIO_TIMEOUT_MS || 6 * 60 * 1000);
const STEPS = Math.max(4, Number(process.env.NATURAL_AUDIO_STEPS || 8));
const cache = new Map();

function parameterName(parameter) {
  return String(parameter?.parameter_name || parameter?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function parameterDefault(parameter) {
  return parameter?.parameter_default ?? parameter?.default ?? null;
}

function findEndpoint(api) {
  const entries = Object.entries(api?.named_endpoints || {});
  const candidate = entries
    .filter(([, info]) => Array.isArray(info?.parameters))
    .map(([name, info]) => {
      const names = info.parameters.map(parameterName);
      let score = 0;
      if (name === '/infer') score += 20;
      if (name.toLowerCase().includes('infer')) score += 10;
      if (names.some(n => n.includes('prompt'))) score += 10;
      if (names.some(n => n.includes('duration'))) score += 5;
      if (names.some(n => n.includes('variant'))) score += 5;
      return { name, info, score };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (!candidate || candidate.score < 15) throw new Error(`El Space de audio ${AUDIO_SPACE} no expone un generador compatible.`);
  return candidate;
}

function buildPayload(endpointInfo, prompt, duration) {
  const parameters = endpointInfo?.parameters || [];
  return parameters.map(parameter => {
    const name = parameterName(parameter);
    if (name.includes('variant')) return process.env.NATURAL_AUDIO_VARIANT || 'small-sfx';
    if (name.includes('prompt') && !name.includes('negative')) return prompt;
    if (name.includes('negative')) return 'speech, narration, dialogue, voice, vocals, lyrics, music, song, low quality, distorted audio';
    if (name.includes('duration') || name.includes('seconds')) return duration;
    if (name.includes('steps') || name.includes('inference')) return STEPS;
    if (name.includes('cfg') || name.includes('guidance')) return 1.0;
    if (name.includes('sampler')) return 'pingpong';
    if (name.includes('seed')) return 0;
    const fallback = parameterDefault(parameter);
    if (fallback !== null && fallback !== undefined) return fallback;
    if (parameter?.type === 'boolean' || parameter?.component === 'Checkbox') return false;
    if (parameter?.type === 'number' || parameter?.component === 'Number' || parameter?.component === 'Slider') return 0;
    return '';
  });
}

function findAudioReference(value, seen = new Set()) {
  if (value == null || seen.has(value)) return '';
  if (typeof value === 'object') seen.add(value);
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return value;
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioReference(item, seen);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'audio', 'output', 'path', 'data']) {
      const found = findAudioReference(value[key], seen);
      if (found) return found;
    }
  }
  return '';
}

function naturalPrompt(scenePrompt) {
  const clean = String(scenePrompt || '').trim().slice(0, 3500);
  if (!clean) throw new Error('Falta el prompt de la escena para crear el audio natural.');
  return [
    'Create realistic cinematic sound effects and natural ambience for this video scene.',
    `SCENE: ${clean}`,
    'Use only sounds that naturally belong to the described scene and actions.',
    'Synchronize the sound character with the described actions and environment.',
    'No narration, no spoken words, no dialogue, no voice, no vocals, no lyrics, no music.'
  ].join(' ');
}

async function generateWithSpace(prompt, duration, outputDir) {
  const app = await Client.connect(AUDIO_SPACE, {
    ...(HF_TOKEN ? { token: HF_TOKEN } : {}),
    events: ['status', 'data']
  });
  const api = await app.view_api();
  const { name: endpoint, info } = findEndpoint(api);
  const payload = buildPayload(info, prompt, duration);
  const job = app.submit(endpoint, payload);
  const deadline = Date.now() + TIMEOUT_MS;
  let result = null;

  for await (const message of job) {
    if (Date.now() > deadline) {
      try { job.cancel?.(); } catch (_) {}
      throw new Error('El generador de audio natural tardó demasiado.');
    }
    if (message?.type === 'data') result = message.data;
    if (message?.type === 'status' && message.success === false && String(message.stage || '').toLowerCase() === 'error') {
      throw new Error(message.message || 'El generador de audio natural reportó un error.');
    }
  }

  const audioUrl = findAudioReference(result);
  if (!audioUrl) throw new Error('El generador de audio natural terminó sin devolver un archivo de sonido.');
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`No se pudo descargar el audio natural (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('El generador de audio natural devolvió un archivo vacío.');

  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `natural-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  await fs.writeFile(outputPath, bytes);
  return { filePath: outputPath, provider: 'Stable Audio 3 · small-sfx', space: AUDIO_SPACE };
}

export async function generateNaturalAudio({ prompt, duration = 5, outputDir }) {
  const seconds = Math.min(60, Math.max(1, Math.round(Number(duration) || 5)));
  const scene = naturalPrompt(prompt);
  const dir = outputDir || path.join(process.cwd(), 'public', 'generated-audio');
  const key = `${AUDIO_SPACE}|${seconds}|${scene}`;
  if (cache.has(key)) return cache.get(key);

  const promise = generateWithSpace(scene, seconds, dir).catch(error => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}
