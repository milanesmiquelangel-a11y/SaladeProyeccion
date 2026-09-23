import fs from 'node:fs/promises';
import path from 'node:path';

const WAN_KEY = String(process.env.DASHSCOPE_API_KEY || '').trim();
const WAN_WORKSPACE = String(process.env.DASHSCOPE_WORKSPACE_ID || '').trim();
const WAN_BASE = String(process.env.DASHSCOPE_BASE_URL || (WAN_WORKSPACE ? `https://${WAN_WORKSPACE}.ap-southeast-1.maas.aliyuncs.com` : '')).replace(/\/$/, '');
const WAN_IMAGE_MODEL = String(process.env.WAN_IMAGE_MODEL || 'wan2.7-image').trim();
const WAN_I2V_MODEL = String(process.env.WAN_I2V_MODEL || 'wan2.7-i2v-2026-04-25').trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || 'https://sala-de-proyeccion.onrender.com').replace(/\/$/, '');

function authHeaders() {
  return {
    Authorization: `Bearer ${WAN_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function readJson(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.code || `HTTP ${response.status}`;
    throw new Error(`Wan API: ${message}`);
  }
  return data;
}

function requireWan() {
  if (!WAN_KEY) throw new Error('Wan 2.7 no está configurado. Añade DASHSCOPE_API_KEY en Render.');
  if (!WAN_WORKSPACE || !WAN_BASE) throw new Error('Wan 2.7 necesita DASHSCOPE_WORKSPACE_ID de la región Singapore.');
}

function imageSize(aspect = '16:9') {
  if (aspect === '9:16') return '720*1280';
  if (aspect === '1:1') return '1024*1024';
  return '1280*720';
}

async function download(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el recurso de Wan (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

function extractImageUrl(data) {
  const choices = data?.output?.choices || [];
  for (const choice of choices) {
    const content = choice?.message?.content || [];
    for (const item of content) {
      if (item?.type === 'image' && item?.image) return item.image;
    }
  }
  return null;
}

export function wanMediaConfigured() {
  return Boolean(WAN_KEY && WAN_WORKSPACE && WAN_BASE);
}

export async function generateWanCharacterImage({ prompt, aspect, outputDir }) {
  requireWan();
  const scene = String(prompt || '').trim();
  if (!scene) throw new Error('La descripción de la escena es obligatoria para crear el personaje.');

  const response = await fetch(`${WAN_BASE}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: WAN_IMAGE_MODEL,
      input: {
        messages: [{
          role: 'user',
          content: [{
            text: `Create a single cinematic first-frame image for this video scene. Preserve a clear, visible main character suitable for facial animation and dialogue. ${scene}`
          }]
        }]
      },
      parameters: {
        size: imageSize(aspect),
        n: 1,
        watermark: false
      }
    })
  });

  const data = await readJson(response);
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) throw new Error('Wan Image no devolvió una imagen de referencia.');

  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `character-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  await download(imageUrl, outputPath);
  return { filePath: outputPath, provider: `Wan ${WAN_IMAGE_MODEL}` };
}

export async function generateWanLipSyncVideo({ prompt, imagePath, audioUrl, duration, outputDir }) {
  requireWan();
  if (!imagePath) throw new Error('Falta la imagen de referencia del personaje.');
  if (!audioUrl) throw new Error('Falta el audio de conducción para sincronizar los labios.');

  const imageBuffer = await fs.readFile(imagePath);
  const imageData = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const response = await fetch(`${WAN_BASE}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: { ...authHeaders(), 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model: WAN_I2V_MODEL,
      input: {
        prompt,
        media: [
          { type: 'first_frame', url: imageData },
          { type: 'driving_audio', url: audioUrl }
        ]
      },
      parameters: {
        resolution: '720P',
        duration: Math.max(2, Math.min(15, Math.round(Number(duration) || 5))),
        prompt_extend: true,
        watermark: false
      }
    })
  });

  const data = await readJson(response);
  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error('Wan I2V no devolvió task_id.');

  const deadline = Date.now() + 20 * 60 * 1000;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const statusResponse = await fetch(`${WAN_BASE}/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${WAN_KEY}` } });
    const status = await readJson(statusResponse);
    last = status?.output?.task_status || status?.task_status || null;

    if (last === 'SUCCEEDED') {
      const videoUrl = status?.output?.video_url || status?.output?.video?.url;
      if (!videoUrl) throw new Error('Wan I2V terminó sin devolver video_url.');
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `wan-i2v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
      await download(videoUrl, outputPath);
      return { filePath: outputPath, provider: 'Wan 2.7 I2V', nativeAudio: true, taskId };
    }
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(last)) {
      const message = status?.output?.message || status?.message || status?.code || `estado ${last}`;
      throw new Error(`Wan I2V falló: ${message}`);
    }
  }

  throw new Error(`Wan I2V superó el tiempo máximo de espera (último estado: ${last || 'desconocido'}).`);
}

export function publicAudioUrl(filePath) {
  return `${PUBLIC_BASE_URL}/generated-audio/${encodeURIComponent(path.basename(filePath))}`;
}
