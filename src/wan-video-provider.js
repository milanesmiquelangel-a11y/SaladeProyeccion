import { Client } from '@gradio/client';

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

function outputUrl(data) {
  const values = Array.isArray(data) ? data : [data];
  for (const value of values) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === 'object') {
      for (const candidate of [value.url, value.path, value.video?.url, value.video?.path]) {
        if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
      }
    }
  }
  return '';
}

function chooseEndpoint(api) {
  const named = api?.named_endpoints || {};
  const available = Object.keys(named);
  // The current public fffiloni/Wan2.1 Space uses simple_app.py with /infer(prompt).
  if (available.includes('/infer')) return '/infer';
  if (CONFIGURED_ENDPOINT && available.includes(CONFIGURED_ENDPOINT)) return CONFIGURED_ENDPOINT;
  if (available.includes('/t2v_generation')) return '/t2v_generation';
  if (available.length === 1) return available[0];
  throw new Error(`El Space ${SPACE} no expone un endpoint WAN compatible. Endpoints disponibles: ${available.join(', ') || 'ninguno'}.`);
}

function buildInputs(endpoint, prompt, negative, aspect) {
  if (endpoint === '/infer') return [prompt];
  const resolution = aspect === '9:16' ? '480*832' : aspect === '1:1' ? '624*624' : '832*480';
  return [
    prompt,
    resolution,
    Number(process.env.WAN_STEPS || 20),
    Number(process.env.WAN_GUIDE_SCALE || 6),
    Number(process.env.WAN_SHIFT_SCALE || 8),
    -1,
    String(negative || '')
  ];
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
  const url = outputUrl(finalData);
  if (!url) throw new Error('WAN 2.1 terminó sin devolver el archivo de vídeo.');
  job.providerState = 'COMPLETED';
  return url;
}

export function cancelWanVideo(job) {
  try { job.gradioJob?.cancel?.(); } catch (_) {}
  job.gradioJob = null;
}
