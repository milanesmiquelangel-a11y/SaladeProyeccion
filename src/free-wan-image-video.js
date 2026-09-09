import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');

// Free Hugging Face ZeroGPU Space running the local Wan2.2-Animate-2-14B
// pipeline. Unlike the previous community proxy, this Space performs the
// animation itself and exposes the /animate Gradio endpoint directly.
const WAN_SPACE = process.env.WAN_FREE_SPACE || 'hugging-apps/wan2-2-animate-2-14b';
const WAN_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/animate';
const WAN_MOTION_TEMPLATE = process.env.WAN_MOTION_TEMPLATE ||
  'https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/examples/wan_animate/animate/video.mp4';

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
    return value.url || value.path || value.video?.url || value.video?.path || '';
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
  if (!videoValue) throw new Error('Wan2.2 terminó sin devolver el vídeo generado.');

  await fs.mkdir(freeOutputDir, { recursive: true });
  const filename = `wan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const destination = path.join(freeOutputDir, filename);

  // Gradio can return either a downloaded local filepath or a remote URL.
  // Handle both so the generated file is always served by Sala de Proyección.
  if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    }
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, destination);
  }

  return `/free-image-video/${filename}`;
}

export async function generateFreeWanImageVideo({ imagePath, prompt }) {
  try {
    const app = await Client.connect(WAN_SPACE);
    const api = await app.view_api();
    const endpointInfo = api?.named_endpoints?.[WAN_ENDPOINT];
    if (!endpointInfo) {
      throw new Error(`El Space ${WAN_SPACE} no expone actualmente ${WAN_ENDPOINT}.`);
    }

    const referenceImage = handle_file(imagePath);
    const drivingVideo = handle_file(WAN_MOTION_TEMPLATE);
    const animationPrompt = [
      'Photorealistic person animation.',
      'Preserve the exact identity, face, hair, clothing, body proportions and overall appearance from the reference photograph.',
      'Keep the same scene and background. Do not redesign or replace the person.',
      'Natural subtle human motion: gentle breathing, realistic blinking and a very small natural head movement.',
      'Stable identity throughout the whole clip, realistic anatomy, no morphing, no duplicate person, no face distortion.',
      String(prompt || '').trim()
    ].filter(Boolean).join(' ');

    // Wan2.2-Animate-2-14B uses the reference image plus a driving video.
    // max_seconds=5 matches the Sala de Proyección 5-second clip option.
    const result = await app.predict(WAN_ENDPOINT, [
      referenceImage,
      drivingVideo,
      animationPrompt.slice(0, 4000),
      5,
      480,
      640,
      6,
      1,
      5,
      'distorted face, identity drift, morphing, extra people, duplicate body parts, deformed hands, cartoon, CGI',
      0
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickVideoValue(item)) || data[0];
    const outputUrl = await saveVideoResult(output);

    return {
      outputUrl,
      provider: `Wan2.2 Animate (${WAN_SPACE})`,
      detail: 'Vídeo generado con Wan2.2 Animate-2-14B usando la fotografía como referencia de identidad y movimiento de un vídeo guía.'
    };
  } catch (error) {
    throw new Error(`Wan2.2 no pudo generar el vídeo: ${describeError(error)}`);
  }
}
