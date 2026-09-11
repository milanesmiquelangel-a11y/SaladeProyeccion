import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');

// Free image-to-video engine: Wan 2.1 I2V Fast on the public Hugging Face
// ZeroGPU Space. The Space currently exposes a Gradio API backed by the
// Wan2.1-I2V-14B model + CausVid LoRA and is designed for fast 4-8 step runs.
const VIDEO_SPACE = process.env.WAN_FREE_SPACE || 'multimodalart/wan2-1-fast';
const VIDEO_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/generate_video';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

const DEFAULT_PROMPT = [
  'Photorealistic cinematic image-to-video animation.',
  'Use the supplied photograph as the strongest visual identity reference.',
  'Preserve the exact same person, face, facial structure, hairstyle, clothing, body proportions and scene.',
  'Do not replace, redesign or reinterpret the person.',
  'Keep the person in the same position with subtle natural movement: gentle breathing, natural blinking when a face is visible, and a very small realistic head movement.',
  'Stable identity and anatomy throughout the clip, stable clothing and background, realistic skin and natural physics.',
  'No identity drift, no morphing, no face replacement, no extra people, no duplicate limbs, no deformed hands, no distorted face, no cartoon or CGI appearance.'
].join(' ');

const DEFAULT_NEGATIVE = [
  'identity drift', 'morphing', 'face distortion', 'changed person', 'extra people',
  'duplicate body parts', 'deformed hands', 'unstable clothing', 'unstable background',
  'cartoon', 'CGI', 'low resolution', 'blurry', 'pixelated', 'text', 'watermark'
].join(', ');

function pickVideoValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickVideoValue(item);
      if (picked) return picked;
    }
    return '';
  }
  if (typeof value === 'object') {
    return value.url || value.path || value.video?.url || value.video?.path || value.video?.name || '';
  }
  return '';
}

function describeError(error) {
  const message = error?.message || String(error || 'Error desconocido');
  const cause = error?.cause?.message ? ` (${error.cause.message})` : '';
  return `${message}${cause}`;
}

async function saveVideoResult(value) {
  const videoValue = pickVideoValue(value);
  if (!videoValue) throw new Error('Wan 2.1 terminó sin devolver el vídeo generado.');

  await fs.mkdir(freeOutputDir, { recursive: true });
  const filename = `wan-i2v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const destination = path.join(freeOutputDir, filename);

  if (videoValue.startsWith('data:')) {
    const comma = videoValue.indexOf(',');
    if (comma < 0) throw new Error('Wan 2.1 devolvió un vídeo en formato no válido.');
    await fs.writeFile(destination, Buffer.from(videoValue.slice(comma + 1), 'base64'));
  } else if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, destination);
  }

  return `/free-image-video/${filename}`;
}

function findEndpoint(api) {
  const named = api?.named_endpoints || {};
  if (named[VIDEO_ENDPOINT]) return VIDEO_ENDPOINT;

  const candidates = Object.entries(named).filter(([, spec]) => {
    const params = Array.isArray(spec?.parameters) ? spec.parameters : [];
    return params.some((p) => String(p?.component || '').toLowerCase() === 'image') && params.length >= 4;
  });
  if (candidates.length) return candidates[0][0];

  const all = Object.keys(named);
  if (all.length === 1) return all[0];
  return '';
}

export async function generateFreeWanImageVideo({ imagePath, prompt }) {
  try {
    if (!HF_TOKEN) {
      throw new Error('Hugging Face requiere autenticación. Configura HF_TOKEN en Render con un token personal de Hugging Face con permiso Read.');
    }
    if (!imagePath) throw new Error('No se encontró la fotografía temporal para animar.');

    const { Client, handle_file } = await import('@gradio/client');
    const app = await Client.connect(VIDEO_SPACE, { token: HF_TOKEN });
    const api = await app.view_api();
    const endpoint = findEndpoint(api);

    if (!endpoint) {
      const available = Object.keys(api?.named_endpoints || {}).join(', ');
      throw new Error(`El Space ${VIDEO_SPACE} no expone un endpoint compatible. Endpoints encontrados: ${available || 'ninguno'}.`);
    }

    const animationPrompt = [DEFAULT_PROMPT, String(prompt || '').trim()].filter(Boolean).join(' ').slice(0, 6000);

    // These 10 inputs mirror the current public Wan2.1 Fast Space:
    // image, prompt, height, width, negative prompt, duration, guidance,
    // steps, seed and randomize-seed.
    const result = await app.predict(endpoint, [
      handle_file(imagePath),
      animationPrompt,
      512,
      896,
      DEFAULT_NEGATIVE,
      5,
      1,
      4,
      42,
      true
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickVideoValue(item?.video || item)) || data[0];
    const outputUrl = await saveVideoResult(output?.video || output);

    return {
      outputUrl,
      provider: `Wan 2.1 I2V Fast (${VIDEO_SPACE})`,
      detail: 'Vídeo generado con Wan 2.1 I2V Fast desde la fotografía.'
    };
  } catch (error) {
    throw new Error(`Wan 2.1 I2V no pudo generar el vídeo: ${describeError(error)}`);
  } finally {
    if (imagePath) await fs.rm(imagePath, { force: true }).catch(() => {});
  }
}
