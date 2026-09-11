import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');
const generatedAudioDir = path.join(publicDir, 'generated-audio');

const VIDEO_SPACE = process.env.WAN_FREE_SPACE || 'Lightricks/ltx-2-distilled';
const VIDEO_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/generate_video';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

function fileURLToPath(url) {
  return new URL(url).pathname;
}

function pickVideoValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickVideoValue(item);
      if (picked) return picked;
    }
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
  if (!videoValue) throw new Error('LTX-2 terminó sin devolver el vídeo generado.');
  await fs.mkdir(freeOutputDir, { recursive: true });
  const filename = `ltx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const destination = path.join(freeOutputDir, filename);
  if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, destination);
  }
  return `/free-image-video/${filename}`;
}

function parsePrompt(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (parsed && typeof parsed === 'object') {
      return {
        motion: String(parsed.motion || '').trim(),
        audioText: String(parsed.audioText || '').trim().slice(0, 4000),
        audioLanguage: String(parsed.audioLanguage || 'en').trim() || 'en'
      };
    }
  } catch {}
  return { motion: String(value || '').trim(), audioText: '', audioLanguage: 'en' };
}

export async function generateFreeWanImageVideo({ imagePath, prompt }) {
  try {
    if (!HF_TOKEN) {
      throw new Error('Hugging Face requiere autenticación. Configura HF_TOKEN en Render con un token personal de Hugging Face (permiso Read).');
    }

    const request = parsePrompt(prompt);
    const app = await Client.connect(VIDEO_SPACE, { token: HF_TOKEN });
    const api = await app.view_api();
    if (!api?.named_endpoints?.[VIDEO_ENDPOINT]) {
      const available = Object.keys(api?.named_endpoints || {}).join(', ');
      throw new Error(`El Space ${VIDEO_SPACE} no expone ${VIDEO_ENDPOINT}. Endpoints: ${available || 'ninguno'}.`);
    }

    const referenceImage = handle_file(imagePath);
    const animationPrompt = [
      'Photorealistic cinematic image-to-video animation.',
      'Preserve the exact person in the reference image: same face, identity, hair, clothing, body proportions, skin appearance and background.',
      'Do not replace or redesign the person. No identity drift, face morphing, duplicate person or anatomical deformation.',
      'Very subtle natural movement only: gentle breathing, natural blinking when the face is visible, and a small realistic head movement while staying in the same place.',
      'Stable identity and clothing, realistic anatomy, natural skin, cinematic realism, steady camera.',
      'Generate subtle synchronized ambient audio appropriate to the scene.',
      request.motion
    ].filter(Boolean).join(' ');

    // LTX-2 accepts a reference image and generates video + synchronized audio.
    // Its public Space supports 1–10 seconds; we use 5 seconds directly.
    const result = await app.predict(VIDEO_ENDPOINT, [
      referenceImage,
      animationPrompt.slice(0, 5000),
      5,
      true,
      42,
      false,
      512,
      768
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickVideoValue(item)) || data[0];
    const outputUrl = await saveVideoResult(output);

    return {
      outputUrl,
      provider: `LTX-2 Distilled (${VIDEO_SPACE})`,
      detail: request.audioText
        ? 'Vídeo generado con LTX-2 Distilled con audio nativo sincronizado. La narración solicitada se mantiene disponible para la siguiente capa de mezcla.'
        : 'Vídeo generado con LTX-2 Distilled desde la fotografía, con movimiento IA y audio nativo sincronizado.'
    };
  } catch (error) {
    throw new Error(`LTX-2 no pudo generar el vídeo: ${describeError(error)}`);
  }
}
