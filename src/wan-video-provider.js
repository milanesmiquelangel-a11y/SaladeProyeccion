import { Client } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';

const SPACE = process.env.WAN_SPACE_ID || 'fffiloni/Wan2.1';
const CONFIGURED_ENDPOINT = String(process.env.WAN_ENDPOINT || '').trim();
const HF_TOKEN = process.env.HF_TOKEN || undefined;
let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = Client.connect(SPACE, {
      ...(HF_TOKEN ? { token: HF_TOKEN } : {}),
      events: ['status', 'data'],
      space_status: (status) => console.log('[WAN]', status?.status || 'unknown', status?.message || '')
    });
  }
  return clientPromise;
}

function outputReference(data) {
  const values = Array.isArray(data) ? data : [data];
  for (const value of values) {
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) return value;
      if (value.toLowerCase().endsWith('.mp4')) return value;
    }
    if (value && typeof value === 'object') {
      for (const candidate of [value.url, value.path, value.video?.url, value.video?.path]) {
        if (typeof candidate !== 'string') continue;
        if (/^https?:\/\//i.test(candidate)) return candidate;
        if (candidate.toLowerCase().endsWith('.mp4')) return candidate;
      }
    }
  }
  return '';
}

function chooseEndpoint(api) {
  const named = api?.named_endpoints || {};
  const available = Object.keys(named);
  if (available.includes('/infer')) return '/infer';
  if (CONFIGURED_ENDPOINT && available.includes(CONFIGURED_ENDPOINT)) return CONFIGURED_ENDPOINT;
  if (available.includes('/t2v_generation')) return '/t2v_generation';
  if (available.length === 1) return available[0];
  throw new Error(`El Space ${SPACE} no expone un endpoint WAN compatible. Endpoints disponibles: ${available.join(', ') || 'ninguno'}.`);
}

function buildInputs(endpoint, prompt, negative, aspect) {
  if (endpoint === '/infer') return [prompt];
  const resolution = aspect === '9:16' ? '480*832' : aspect === '1:1' ? '624*624' : '832*480';
  return [prompt, resolution, Number(process.env.WAN_STEPS || 20), Number(process.env.WAN_GUIDE_SCALE || 6), Number(process.env.WAN_SHIFT_SCALE || 8), -1, String(negative || '')];
}

export async function generateWanVideo({ prompt, negative, aspect = '16:9', job }) {
  const app = await getClient();
  const api = await app.view_api();
  const endpoint = chooseEndpoint(api);
  job.providerState = 'QUEUED';
  job.providerEndpoint = endpoint;
  job.detail = `WAN 2.1 conectado (${endpoint}). Enviando el prompt…`;

  const submission = app.submit(endpoint, buildInputs(endpoint, prompt, negative, aspect));
  job.gradioJob = submission;

  let finalData = null;
  for await (const message of submission) {
    if (message.type === 'status') {
      const status = message.status || {};
      job.providerState = String(status.stage || 'PROCESSING').toUpperCase();
      if (status.position != null) job.detail = `WAN 2.1 está en cola (posición ${status.position})…`;
      else if (status.eta != null) job.detail = `WAN 2.1 está procesando (estimación ${Math.ceil(status.eta)} s)…`;
      else job.detail = 'WAN 2.1 está generando el vídeo…';
    }
    if (message.type === 'data') finalData = message.data;
  }

  job.gradioJob = null;
  const reference = outputReference(finalData);
  if (!reference) {
    throw new Error(`WAN 2.1 terminó, pero no se pudo localizar el archivo de vídeo. Respuesta: ${JSON.stringify(finalData).slice(0, 1200)}`);
  }
  if (!/^https?:\/\//i.test(reference)) {
    const resolved = path.isAbsolute(reference) ? reference : path.resolve(process.cwd(), reference);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) throw new Error('La salida WAN no es un archivo.');
      job.detail = 'WAN 2.1 terminó; preparando el vídeo generado…';
      return resolved;
    } catch (error) {
      throw new Error(`WAN 2.1 devolvió una ruta de vídeo que no existe en el servidor: ${reference}`);
    }
  }
  job.providerState = 'COMPLETED';
  return reference;
}

export function cancelWanVideo(job) {
  try { job.gradioJob?.cancel?.(); } catch (_) {}
  job.gradioJob = null;
}
