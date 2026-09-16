import { Client, handle_file } from '@gradio/client';

// Primary free backend currently running on Hugging Face ZeroGPU.
// The provider is discovered dynamically through Gradio's view_api(), so UI/API
// changes in the Space do not require hard-coded parameter positions.
const configuredSpace = String(process.env.WAN_SPACE_ID || '').trim();
const configuredEndpoint = String(process.env.WAN_ENDPOINT || '').trim();
const HF_TOKEN = String(process.env.HF_TOKEN || '').trim() || undefined;

// Verified 2026-09-16: these public Spaces are the intended free WAN 2.2 fallbacks.
// Wan-AI/Wan-2.2-5B is retained last as a recovery option if its owner resumes it.
const DEFAULT_SPACES = [
  'Upsampler/wan-2-2-5b-video',
  'ginigen/Wan-2.2-Enhanced',
  'Wan-AI/Wan-2.2-5B'
];
const FALLBACK_SPACES = [configuredSpace, ...DEFAULT_SPACES]
  .filter(Boolean)
  .filter((space, index, list) => list.indexOf(space) === index && !/wan2\.1/i.test(space));

const clientPromises = new Map();
const CONNECT_TIMEOUT_MS = Number(process.env.WAN_CONNECT_TIMEOUT_MS || 45000);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} tardó demasiado (>${Math.round(ms / 1000)}s).`), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isQuotaError(error) {
  const text = `${error?.message || error}`.toLowerCase();
  return text.includes('quota') || text.includes('gpu task aborted') || text.includes('exceeded') || text.includes('too many requests') || text.includes('429');
}

function isSleepingOrPausedError(error) {
  const text = `${error?.message || error}`.toLowerCase();
  return text.includes('paused') || text.includes('sleeping') || text.includes('runtime error') || text.includes('building') || text.includes('not running') || text.includes('could not connect');
}

function spaceOrigin(space) {
  const [owner, name] = String(space).split('/');
  if (!owner || !name) return '';
  return `https://${owner.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')}.hf.space`;
}

async function getClient(space) {
  if (!clientPromises.has(space)) {
    const origin = spaceOrigin(space);
    clientPromises.set(space, Client.connect(origin, {
      ...(HF_TOKEN ? { token: HF_TOKEN } : {}),
      events: ['status', 'data'],
      space_status: (status) => console.log('[WAN 2.2]', space, status?.status || 'unknown', status?.message || '')
    }).catch((error) => {
      clientPromises.delete(space);
      throw error;
    }));
  }
  return clientPromises.get(space);
}

function parameterName(parameter) {
  return String(parameter?.parameter_name || parameter?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function parameterChoices(parameter) {
  return parameter?.parameter_type?.enum || parameter?.choices || parameter?.enum || [];
}

function defaultValue(parameter) {
  return parameter?.parameter_default ?? parameter?.default ?? null;
}

function isFileParameter(parameter) {
  const name = parameterName(parameter);
  const text = `${name} ${parameter?.component || ''} ${parameter?.type || ''}`.toLowerCase();
  return text.includes('image') || text.includes('file') || text.includes('upload');
}

function preferredModelValue(parameter) {
  const choices = parameterChoices(parameter);
  if (!Array.isArray(choices)) return null;
  const wanted = String(process.env.WAN_MODEL || 'Wan2.2').toLowerCase();
  const match = choices.find((choice) => String(typeof choice === 'object' ? (choice.value ?? choice.label ?? '') : choice).toLowerCase().includes(wanted));
  return match == null ? null : (typeof match === 'object' ? (match.value ?? match.label) : match);
}

function numericMetadata(parameter) {
  const sources = [
    parameter,
    parameter?.parameter_type,
    parameter?.type_info,
    parameter?.parameter_type?.number
  ].filter(Boolean);
  const read = (names) => {
    for (const source of sources) {
      for (const name of names) {
        const value = Number(source?.[name]);
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  };
  return {
    minimum: read(['minimum', 'min', 'min_value']),
    maximum: read(['maximum', 'max', 'max_value']),
    step: read(['step'])
  };
}

function clampNumericValue(value, parameter) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const { minimum, maximum, step } = numericMetadata(parameter);
  let result = value;
  if (minimum != null) result = Math.max(minimum, result);
  if (maximum != null) result = Math.min(maximum, result);
  if (step != null && step > 0 && minimum != null) {
    result = minimum + Math.round((result - minimum) / step) * step;
    if (maximum != null) result = Math.min(maximum, result);
  }
  return Number.isInteger(result) ? Math.trunc(result) : Number(result.toFixed(6));
}

function dimensions(aspect) {
  if (aspect === '9:16') return { width: 480, height: 832 };
  if (aspect === '1:1') return { width: 624, height: 624 };
  return { width: 832, height: 480 };
}

function outputReference(data, space) {
  const origin = spaceOrigin(space);
  if (data == null) return '';
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = outputReference(item, space);
      if (found) return found;
    }
    return '';
  }
  if (typeof data === 'string') {
    if (/^https?:\/\//i.test(data)) return data;
    if (data.startsWith('/file=') || data.startsWith('/gradio_api/file=')) return `${origin}${data}`;
    if (/\.mp4(?:\?|$)/i.test(data)) return data;
    return '';
  }
  if (typeof data === 'object') {
    for (const candidate of [data.url, data.path, data.video?.url, data.video?.path, data.data, data.video?.data]) {
      const found = outputReference(candidate, space);
      if (found) return found;
    }
  }
  return '';
}

function chooseEndpoint(api, space, wantsImage) {
  const named = api?.named_endpoints || {};
  const entries = Object.entries(named);
  if (!entries.length) throw new Error(`El Space ${space} no expone endpoints Gradio.`);
  if (configuredEndpoint && named[configuredEndpoint]) return [configuredEndpoint, named[configuredEndpoint]];

  const candidates = entries.map(([name, info]) => {
    const params = Array.isArray(info?.parameters) ? info.parameters : [];
    const names = params.map(parameterName);
    const hasPrompt = names.some((value) => value === 'prompt' || value.includes('prompt'));
    const imageParams = params.filter(isFileParameter);
    const hasVideoReturn = (info?.returns || []).some((item) => `${item?.label || ''} ${item?.component || ''}`.toLowerCase().includes('video'));
    const imageName = imageParams.some((p) => parameterName(p).includes('image'));
    let score = 0;
    if (hasPrompt) score += 20;
    if (hasVideoReturn) score += 15;
    if (name.toLowerCase().includes('generate')) score += 10;
    if (name.toLowerCase().includes('video')) score += 5;
    if (wantsImage && imageName) score += 20;
    if (!wantsImage && imageParams.length === 0) score += 20;
    if (!wantsImage && imageParams.some((p) => defaultValue(p) == null)) score -= 100;
    return { name, info, params, score };
  }).filter((item) => item.params.some((p) => parameterName(p).includes('prompt')))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) throw new Error(`El Space ${space} no tiene un endpoint compatible.`);
  return [candidates[0].name, candidates[0].info];
}

function buildInputs(endpointInfo, { prompt, negative, aspect, imagePath }) {
  const params = Array.isArray(endpointInfo?.parameters) ? endpointInfo.parameters : [];
  const { width, height } = dimensions(aspect);
  const frames = Number(process.env.WAN_FRAMES || 49);
  const requestedSteps = Number(process.env.WAN_STEPS || 8);
  const steps = Number.isFinite(requestedSteps) ? Math.max(1, Math.trunc(requestedSteps)) : 8;
  const guidance = Number(process.env.WAN_GUIDE_SCALE || 5);
  const values = [];

  for (const parameter of params) {
    const name = parameterName(parameter);
    const lower = name.toLowerCase();
    let value = defaultValue(parameter);

    if (lower === 'prompt' || (lower.includes('prompt') && !lower.includes('negative'))) value = prompt;
    else if (lower.includes('negative')) value = String(negative || '');
    else if (lower === 'height' || lower.includes('height')) value = height;
    else if (lower === 'width' || lower.includes('width')) value = width;
    else if (lower.includes('num_frames') || lower === 'frames' || lower.includes('frame_num')) value = frames;
    else if (lower.includes('duration')) value = 5;
    else if (lower.includes('sampling_steps') || lower.includes('steps') || lower.includes('inference')) value = steps;
    else if (lower.includes('guidance') || lower.includes('cfg') || lower.includes('guide_scale')) value = guidance;
    else if (lower.includes('frame_rate') || lower === 'fps') value = 24;
    else if (lower.includes('seed')) {
      // Some current Gradio Spaces declare seed minimum=0 even though the
      // original Wan demo used -1 as the UI sentinel for randomization.
      // Clamp to the live API's declared range instead of sending -1 blindly.
      const defaultSeed = Number(defaultValue(parameter));
      value = Number.isFinite(defaultSeed) && defaultSeed >= 0 ? defaultSeed : 0;
    }
    else if (lower === 'model' || lower.includes('model_choice') || lower.includes('model_id')) value = preferredModelValue(parameter) ?? value;
    else if (isFileParameter(parameter)) {
      if (imagePath) value = handle_file(imagePath);
      else if (defaultValue(parameter) != null) value = defaultValue(parameter);
      else value = null;
    }

    if (value == null && (parameter?.type === 'boolean' || parameter?.component === 'Checkbox')) value = false;
    if (value == null && (parameter?.type === 'number' || parameter?.component === 'Number' || parameter?.component === 'Slider')) value = 0;
    if (value == null && (parameter?.type === 'string' || parameter?.component === 'Textbox')) value = '';
    if (typeof value === 'number') value = clampNumericValue(value, parameter);
    values.push(value);
  }
  return values;
}

export async function generateWanVideo({ prompt, negative = '', aspect = '16:9', imagePath = '', job }) {
  const errors = [];
  let anyQuotaError = false;
  for (const space of FALLBACK_SPACES) {
    try {
      if (job) {
        job.providerState = 'CONNECTING';
        job.providerEndpoint = space;
        job.detail = `Conectando con WAN 2.2 (${space})…`;
      }
      const app = await withTimeout(getClient(space), CONNECT_TIMEOUT_MS, `Conexión con ${space}`);
      const api = await withTimeout(app.view_api(), CONNECT_TIMEOUT_MS, `Lectura de API de ${space}`);
      const [endpoint, endpointInfo] = chooseEndpoint(api, space, Boolean(imagePath));
      const inputs = buildInputs(endpointInfo, { prompt, negative, aspect, imagePath });
      if (job) {
        job.providerState = 'PROCESSING';
        job.providerEndpoint = `${space}${endpoint}`;
        job.detail = `WAN 2.2 generando vídeo (${space})…`;
      }
      const result = await app.predict(endpoint, inputs);
      const reference = outputReference(result?.data ?? result, space);
      if (!reference) throw new Error(`WAN 2.2 no devolvió un archivo de vídeo: ${JSON.stringify(result).slice(0, 1000)}`);
      if (job) {
        job.providerState = 'COMPLETED';
        job.detail = 'WAN 2.2 terminó la generación.';
      }
      return reference;
    } catch (error) {
      clientPromises.delete(space);
      if (isQuotaError(error)) anyQuotaError = true;
      errors.push(`${space}: ${error?.message || error}`);
      console.error(`[WAN 2.2] ${space} falló:`, error?.stack || error?.message || error);
      if (job) {
        job.detail = isSleepingOrPausedError(error)
          ? `WAN 2.2 (${space}) está pausado o iniciándose; probando otro backend gratuito…`
          : isQuotaError(error)
            ? `WAN 2.2 (${space}) alcanzó el límite gratuito de GPU; probando otro backend gratuito…`
            : `WAN 2.2 (${space}) no disponible; probando otro backend gratuito…`;
      }
    }
  }
  const summary = anyQuotaError
    ? 'Todos los backends gratuitos de WAN 2.2 alcanzaron su cuota gratuita de GPU (ZeroGPU) en este momento. Este es un límite del proveedor gratuito, no un error del servidor: vuelve a intentarlo en unos minutos, o añade un token de Hugging Face (HF_TOKEN) para obtener más cuota.'
    : 'No fue posible generar el vídeo con ninguno de los backends gratuitos de WAN 2.2 configurados.';
  throw new Error(`${summary} Detalle: ${errors.join(' | ')}`);
}

export function cancelWanVideo(job) {
  try { job?.gradioJob?.cancel?.(); } catch (_) {}
  if (job) job.gradioJob = null;
}
