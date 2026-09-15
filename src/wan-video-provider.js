import { Client } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// The previous public fffiloni/Wan2.1 Space is not a public inference backend:
// its own UI says it must be duplicated and given a GPU. Calling it from our
// server therefore produced the exact "Error executing command" seen by users.
// Use a public ZeroGPU T2V 1.3B Space instead. It keeps WAN 2.1 and does not
// require us to run the model on Render.
const SPACE = process.env.WAN_SPACE_ID || '0AstroKnight0/wan2.1-t2v-1.3b-demo';
const CONFIGURED_ENDPOINT = String(process.env.WAN_ENDPOINT || '').trim();
const HF_TOKEN = process.env.HF_TOKEN || undefined;
const generatedDir = path.join(process.cwd(), 'public', 'generated');
let clientPromise;

function spaceOrigin(space) {
  const [owner, name] = String(space).split('/');
  if (!owner || !name) return '';
  return `https://${owner.toLowerCase()}-${name.toLowerCase().replace(/_/g, '-')}.hf.space`;
}

const SPACE_ORIGIN = spaceOrigin(SPACE);

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

function asRemoteUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/file=') || value.startsWith('/gradio_api/file=')) {
    return `${SPACE_ORIGIN}${value}`;
  }
  return '';
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
    const remote = asRemoteUrl(data);
    if (remote) return remote;
    if (data.toLowerCase().endsWith('.mp4')) return data;
    return '';
  }

  if (typeof data === 'object') {
    for (const candidate of [
      data.url,
      data.path,
      data.video?.url,
      data.video?.path,
      data.data,
      data.video?.data
    ]) {
      const found = outputReference(candidate);
      if (found) return found;
    }
  }

  return '';
}

function parameterName(parameter) {
  return String(parameter?.parameter_name || parameter?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function hasDefault(parameter) {
  return Boolean(parameter?.parameter_has_default);
}

function buildInputs(endpointInfo, prompt, negative, aspect) {
  const parameters = Array.isArray(endpointInfo?.parameters) ? endpointInfo.parameters : [];
  const portrait = aspect === '9:16';
  const square = aspect === '1:1';
  const height = portrait ? 832 : square ? 624 : 480;
  const width = portrait ? 480 : square ? 624 : 832;
  const defaultSteps = Number(process.env.WAN_STEPS || 4);
  const defaultGuidance = Number(process.env.WAN_GUIDE_SCALE || 1);
  const defaultFrames = Number(process.env.WAN_FRAMES || 81);
  const values = [];

  for (const parameter of parameters) {
    const name = parameterName(parameter);
    const label = String(parameter?.label || '').toLowerCase();
    let value;

    if (name.includes('prompt') && !name.includes('negative')) value = prompt;
    else if (name.includes('negative')) value = String(negative || '');
    else if (name === 'height' || name.includes('height')) value = height;
    else if (name === 'width' || name.includes('width')) value = width;
    else if (name.includes('num_frames') || name.includes('frames') || name.includes('frame_num')) value = defaultFrames;
    else if (name.includes('duration')) value = 5;
    else if (name.includes('guidance') || name.includes('cfg')) value = defaultGuidance;
    else if (name.includes('steps') || name.includes('inference')) value = defaultSteps;
    else if (name === 'fps' || name.includes('frame_rate')) value = 16;
    else if (name.includes('seed')) value = -1;
    else if (name.includes('image') || name.includes('input_video') || name.includes('video')) {
      if (!hasDefault(parameter)) throw new Error(`El endpoint WAN seleccionado requiere un archivo (${parameter.label || name}) y no es compatible con texto a vídeo.`);
      value = parameter.parameter_default;
    } else if (hasDefault(parameter)) value = parameter.parameter_default;
    else if (parameter?.type === 'boolean' || parameter?.component === 'Checkbox') value = false;
    else if (parameter?.type === 'number' || parameter?.component === 'Number' || parameter?.component === 'Slider') value = 0;
    else if (parameter?.type === 'string' || parameter?.component === 'Textbox') value = '';
    else value = null;

    // Avoid unused label lint noise while keeping compatibility with older
    // Gradio API metadata that exposes label instead of parameter_name.
    void label;
    values.push(value);
  }

  return values;
}

function chooseEndpoint(api) {
  const named = api?.named_endpoints || {};
  const entries = Object.entries(named);
  if (!entries.length) throw new Error(`El Space ${SPACE} no expone endpoints Gradio públicos.`);

  if (CONFIGURED_ENDPOINT && named[CONFIGURED_ENDPOINT]) return [CONFIGURED_ENDPOINT, named[CONFIGURED_ENDPOINT]];

  const ranked = entries
    .filter(([, info]) => Array.isArray(info?.parameters))
    .map(([name, info]) => {
      const names = info.parameters.map(parameterName);
      const hasPrompt = names.some(value => value === 'prompt' || value.includes('prompt'));
      const hasImage = names.some(value => value.includes('image') || value.includes('input_video'));
      const hasVideoReturn = (info.returns || []).some(item => {
        const text = `${item?.label || ''} ${item?.component || ''}`.toLowerCase();
        return text.includes('video') || text.includes('file');
      });
      let score = 0;
      if (hasPrompt) score += 10;
      if (hasVideoReturn) score += 5;
      if (!hasImage) score += 5;
      if (name === '/generate_video') score += 10;
      if (name === '/predict') score += 1;
      return { name, info, score, hasPrompt, hasImage };
    })
    .filter(item => item.hasPrompt && !item.hasImage)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    throw new Error(`El Space ${SPACE} no expone un endpoint WAN 2.1 de texto a vídeo compatible. Endpoints: ${Object.keys(named).join(', ') || 'ninguno'}.`);
  }

  return [ranked[0].name, ranked[0].info];
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
  const [endpoint, endpointInfo] = chooseEndpoint(api);
  const inputs = buildInputs(endpointInfo, prompt, negative, aspect);

  job.providerState = 'PROCESSING';
  job.providerEndpoint = endpoint;
  job.detail = `WAN 2.1 conectado (${SPACE}, ${endpoint}). Generando el vídeo…`;

  let result;
  try {
    result = await app.predict(endpoint, inputs);
  } catch (error) {
    const reason = error?.message || String(error);
    throw new Error(`WAN 2.1 no pudo generar el vídeo: ${reason}`);
  }

  job.gradioJob = null;
  const reference = outputReference(result?.data ?? result);
  if (!reference) {
    throw new Error(`WAN 2.1 terminó, pero la respuesta no contiene un vídeo. Respuesta: ${JSON.stringify(result).slice(0, 1600)}`);
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
