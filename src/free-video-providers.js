import fs from 'node:fs/promises';
import path from 'node:path';

const BYTEPLUS_KEY = process.env.BYTEPLUS_LAS_API_KEY || '';
const BYTEPLUS_BASE = process.env.BYTEPLUS_LAS_BASE_URL || 'https://operator.las.ap-southeast-1.bytepluses.com/api/v1';
const SEEDANCE_MODEL = process.env.SEEDANCE_MODEL || 'dreamina-seedance-2-0-fast-260128';

const WAN_KEY = process.env.DASHSCOPE_API_KEY || '';
const WAN_WORKSPACE = process.env.DASHSCOPE_WORKSPACE_ID || '';
const WAN_BASE = process.env.DASHSCOPE_BASE_URL || (WAN_WORKSPACE
  ? `https://${WAN_WORKSPACE}.ap-southeast-1.maas.aliyuncs.com`
  : 'https://dashscope-intl.aliyuncs.com');
const WAN_MODEL = process.env.WAN_MODEL || 'wan2.7-t2v-2026-04-25';

function jsonHeaders(key) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function readJson(response) {
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { throw new Error(`Proveedor devolvió HTTP ${response.status}: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(data.message || data.error?.message || `Proveedor devolvió HTTP ${response.status}.`);
  return data;
}

export function freeProvidersConfigured() {
  return {
    seedance: Boolean(BYTEPLUS_KEY),
    wan: Boolean(WAN_KEY)
  };
}

async function seedanceCreate({ prompt, duration, aspect }) {
  if (!BYTEPLUS_KEY) throw new Error('Seedance no está configurado. Añade BYTEPLUS_LAS_API_KEY en Render.');
  const ratio = aspect || '16:9';
  const content = [{ type: 'text', text: prompt }];
  const body = {
    model: SEEDANCE_MODEL,
    content,
    generate_audio: true,
    watermark: false,
    execution_expires_after: 3600
  };
  if (duration) body.duration = Math.max(4, Math.min(15, Math.round(duration)));
  if (ratio) body.aspect_ratio = ratio;
  const response = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks`, {
    method: 'POST', headers: jsonHeaders(BYTEPLUS_KEY), body: JSON.stringify(body)
  });
  return readJson(response);
}

async function seedanceStatus(id) {
  const response = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${encodeURIComponent(id)}`, {
    headers: jsonHeaders(BYTEPLUS_KEY)
  });
  return readJson(response);
}

async function wanCreate({ prompt, duration, aspect }) {
  if (!WAN_KEY) throw new Error('Wan 2.7 no está configurado. Añade DASHSCOPE_API_KEY en Render.');
  if (!WAN_WORKSPACE) throw new Error('Wan 2.7 necesita DASHSCOPE_WORKSPACE_ID de la región Singapore.');
  const response = await fetch(`${WAN_BASE}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: { ...jsonHeaders(WAN_KEY), 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model: WAN_MODEL,
      input: { prompt },
      parameters: {
        resolution: '720P',
        duration: Math.max(2, Math.min(15, Math.round(duration || 5))),
        ratio: aspect || '16:9',
        prompt_extend: true,
        watermark: false
      }
    })
  });
  return readJson(response);
}

async function wanStatus(id) {
  const response = await fetch(`${WAN_BASE}/api/v1/tasks/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${WAN_KEY}` }
  });
  return readJson(response);
}

async function downloadTo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el vídeo del proveedor (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

async function waitFor(getStatus, id, timeoutMs = 20 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await getStatus(id);
    const output = data.output || data.data || data;
    const status = String(output.task_status || output.status || '').toUpperCase();
    if (status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'COMPLETED') return output;
    if (['FAILED','CANCELED','CANCELLED','EXPIRED'].includes(status)) {
      throw new Error(output.message || data.message || `La generación terminó con estado ${status}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('El proveedor tardó más de 20 minutos.');
}

export async function generateFreeVideo({ provider, prompt, duration, aspect, outputDir }) {
  const safeProvider = provider === 'seedance' ? 'seedance' : 'wan';
  await fs.mkdir(outputDir, { recursive: true });
  let output;
  if (safeProvider === 'seedance') {
    const created = await seedanceCreate({ prompt, duration, aspect });
    const id = created.id || created.output?.task_id || created.data?.id;
    if (!id) throw new Error('Seedance no devolvió un ID de tarea.');
    output = await waitFor(seedanceStatus, id);
    const url = output.video_url || output.url || output.content?.video_url;
    if (!url) throw new Error('Seedance terminó sin devolver video_url.');
    const filePath = path.join(outputDir, `seedance-${Date.now()}.mp4`);
    await downloadTo(url, filePath);
    return { filePath, provider: 'Seedance 2.0 Fast', nativeAudio: true };
  }
  const created = await wanCreate({ prompt, duration, aspect });
  const id = created.output?.task_id || created.task_id;
  if (!id) throw new Error('Wan 2.7 no devolvió un task_id.');
  output = await waitFor(wanStatus, id);
  const url = output.video_url || output.url;
  if (!url) throw new Error('Wan 2.7 terminó sin devolver video_url.');
  const filePath = path.join(outputDir, `wan27-${Date.now()}.mp4`);
  await downloadTo(url, filePath);
  return { filePath, provider: 'Wan 2.7', nativeAudio: true };
}
