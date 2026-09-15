import { Client } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SPACE = process.env.WAN_SPACE_ID || 'fffiloni/Wan2.1';
const CONFIGURED_ENDPOINT = String(process.env.WAN_ENDPOINT || '').trim();
const HF_TOKEN = process.env.HF_TOKEN || undefined;
const generatedDir = path.join(process.cwd(), 'public', 'generated');
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
  if (data == null) return '';

  if (Array.isArray(data)) {
    for (const value of data) {
      const found = outputReference(value);
      if (found) return found;
    }
    return '';
  }

  if (typeof data === 'string') {
    if (/^https?:\/\//i.test(data)) return data;
    if (data.toLowerCase().endsWith('.mp4')) return data;
    return '';
  }

  if (typeof data === 'object') {
    for (const candidate of [
      data.url,
      data.path,
      data.video?.url,
      data.video?.path,
      data.data
    ]) {
      const found = outputReference(candidate);
      if (found) return found;
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

async function publishLocalVideo(reference) {
  const resolved = path.isAbsolute(reference) ? reference : path.resolve(process.cwd(), reference);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('La salida WAN no es un archivo.');
  await fs.mkdir(generatedDir, { recursive: true });
  const name = `wan-${randomUUID()}.mp4`;
  const destination = path.join(generatedDir, name);
  await fs.copyFile(resolved, destination);
  const port = Number(process.env.PORT || 3000);
  return `http://127.0.0.1:${port}/generated/${name}`;
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
  let lastStatus = null;

  for await (const message of submission) {
    if (message.type === 'status') {
      lastStatus = message.status || message;
      const status = message.status || {};
      const stage = String(status.stage || status.status || 'PROCESSING').toUpperCase();
      job.providerState = stage;

      if (stage === 'ERROR' || status.success === false) {
        const reason = status.message || status.code || 'El Space de WAN informó un error.';
        throw new Error(`WAN 2.1 informó un error: ${reason}`);
      }

      if (status.position != null) job.detail = `WAN 2.1 está en cola (posición ${status.position})…`;
      else if (status.eta != null) job.detail = `WAN 2.1 está procesando (estimación ${Math.ceil(status.eta)} s)…`;
      else job.detail = 'WAN 2.1 está generando el vídeo…';
    }

    if (message.type === 'data') finalData = message.data;
  }

  // Some Gradio client versions complete the async iterator without exposing
  // the final FileData in a data event. Ask the Job for its authoritative result.
  if (!outputReference(finalData)) {
    try {
      const result = await submission.result();
      finalData = result?.data ?? result;
    } catch (error) {
      const reason = error?.message || String(error);
      throw new Error(`WAN 2.1 terminó sin entregar el archivo. ${reason}`);
    }
  }

  job.gradioJob = null;
  const reference = outputReference(finalData);
  if (!reference) {
    const statusText = lastStatus ? ` Estado final: ${JSON.stringify(lastStatus).slice(0, 800)}` : '';
    throw new Error(`WAN 2.1 terminó, pero no se pudo localizar el archivo de vídeo. Respuesta: ${JSON.stringify(finalData).slice(0, 1200)}.${statusText}`);
  }

  if (/^https?:\/\//i.test(reference)) {
    job.providerState = 'COMPLETED';
    job.detail = 'WAN 2.1 terminó; vídeo preparado para FFmpeg…';
    return reference;
  }

  const published = await publishLocalVideo(reference);
  job.providerState = 'COMPLETED';
  job.detail = 'WAN 2.1 terminó; vídeo preparado para FFmpeg…';
  return published;
}

export function cancelWanVideo(job) {
  try { job.gradioJob?.cancel?.(); } catch (_) {}
  job.gradioJob = null;
}
