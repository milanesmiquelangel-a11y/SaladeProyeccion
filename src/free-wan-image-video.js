import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');

// LTX 2.3 Fast: current Hugging Face ZeroGPU image-to-video Space.
// It exposes a fal.ai-style /generate endpoint and supports native audio.
const VIDEO_SPACE = process.env.LTX_FREE_SPACE || 'ShaundeOoO/ltx-2.3-fast';
const VIDEO_ENDPOINT = process.env.LTX_FREE_ENDPOINT || '/generate';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

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
  if (typeof value === 'object') return value.url || value.path || value.video?.url || value.video?.path || '';
  return '';
}

function describeError(error) {
  const message = error?.message || String(error || 'Error desconocido');
  const cause = error?.cause?.message ? ` (${error.cause.message})` : '';
  return `${message}${cause}`;
}

async function saveVideoResult(value) {
  const videoValue = pickVideoValue(value);
  if (!videoValue) throw new Error('LTX 2.3 terminó sin devolver el vídeo generado.');

  await fs.mkdir(freeOutputDir, { recursive: true });
  const filename = `ltx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const destination = path.join(freeOutputDir, filename);

  if (videoValue.startsWith('data:')) {
    const comma = videoValue.indexOf(',');
    if (comma < 0) throw new Error('LTX 2.3 devolvió un vídeo en formato no válido.');
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

export async function generateFreeWanImageVideo({ imagePath, imageUrl, prompt }) {
  try {
    if (!HF_TOKEN) {
      throw new Error('Hugging Face requiere autenticación. Configura HF_TOKEN en Render con un token personal de Hugging Face (permiso Read).');
    }
    if (!imageUrl) throw new Error('LTX 2.3 necesita la URL pública de la fotografía.');

    const { Client } = await import('@gradio/client');
    const app = await Client.connect(VIDEO_SPACE, { token: HF_TOKEN });
    const api = await app.view_api();
    if (!api?.named_endpoints?.[VIDEO_ENDPOINT]) {
      const available = Object.keys(api?.named_endpoints || {}).join(', ');
      throw new Error(`El Space ${VIDEO_SPACE} no expone ${VIDEO_ENDPOINT}. Endpoints: ${available || 'ninguno'}.`);
    }

    const animationPrompt = [
      'Photorealistic cinematic image-to-video animation.',
      'Use the supplied photograph as the strongest visual identity reference.',
      'Preserve the exact same person, face, facial structure, hairstyle, clothing, body proportions and scene.',
      'Do not replace, redesign or reinterpret the person.',
      'Keep the person in the same position with only subtle natural movement: gentle breathing, natural blinking when a face is visible, and a very small realistic head movement.',
      'Stable identity and anatomy throughout the clip, stable clothing and background, realistic skin, natural physics.',
      'No identity drift, no morphing, no face replacement, no extra people, no duplicate limbs, no deformed hands, no distorted face, no cartoon or CGI appearance.',
      String(prompt || '').trim()
    ].filter(Boolean).join(' ');

    const result = await app.predict(VIDEO_ENDPOINT, [
      imageUrl,
      animationPrompt.slice(0, 6000),
      'identity drift, morphing, face distortion, changed person, extra people, duplicate body parts, deformed hands, unstable clothing, unstable background, cartoon, CGI, low resolution, blurry, pixelated, text, watermark',
      '720p',
      5,
      -1,
      'video/h264-mp4',
      true,
      true
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => item?.video || pickVideoValue(item)) || data[0];
    const outputUrl = await saveVideoResult(output?.video || output);

    return {
      outputUrl,
      provider: `LTX 2.3 Fast (${VIDEO_SPACE})`,
      detail: 'Vídeo generado con LTX 2.3 Fast desde la fotografía, con movimiento IA y audio nativo sincronizado.'
    };
  } catch (error) {
    throw new Error(`LTX 2.3 I2V no pudo generar el vídeo: ${describeError(error)}`);
  } finally {
    if (imagePath) await fs.rm(imagePath, { force: true }).catch(() => {});
  }
}
