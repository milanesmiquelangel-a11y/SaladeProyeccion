import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');

// Free/community Hugging Face Space running Wan2.2 Animate.
// Wan-Animate is specifically designed for character animation from a
// reference image plus a driving/template video, which is better suited to
// preserving the person's identity than generic image-to-video.
const WAN_SPACE = process.env.WAN_FREE_SPACE || 'tddandroid/Wan2.2-Animate';
const WAN_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/predict';
const WAN_MOTION_TEMPLATE = process.env.WAN_MOTION_TEMPLATE ||
  'https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/examples/wan_animate/animate/video.mp4';

function pickVideoUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickVideoUrl(item);
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

async function saveRemoteVideo(value) {
  const remoteUrl = pickVideoUrl(value);
  if (!remoteUrl) throw new Error('Wan2.2 terminó sin devolver una URL de vídeo.');
  if (remoteUrl.startsWith('/')) return remoteUrl;
  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(freeOutputDir, { recursive: true });
  const filename = `wan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  await fs.writeFile(path.join(freeOutputDir, filename), buffer);
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

    // The public Wan2.2 Animate Space uses exactly these four inputs:
    // reference image, template/driving video, move/mix mode and quality.
    // Move mode animates the supplied reference character.
    const result = await app.predict(WAN_ENDPOINT, [
      referenceImage,
      drivingVideo,
      'wan2.2-animate-move',
      'wan-std'
    ]);

    const data = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
    const output = data.find((item) => pickVideoUrl(item)) || data[0];
    const outputUrl = await saveRemoteVideo(output);
    return {
      outputUrl,
      provider: `Wan2.2 Animate (${WAN_SPACE})`,
      detail: 'Vídeo generado con Wan2.2 Animate en modo Move usando la fotografía como personaje de referencia.'
    };
  } catch (error) {
    throw new Error(`Wan2.2 no pudo generar el vídeo: ${describeError(error)}`);
  }
}
