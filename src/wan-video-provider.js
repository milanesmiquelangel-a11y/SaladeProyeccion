import { Client } from '@gradio/client';

// WAN 2.2 is now the video engine. Prefer the public, fast 5B text/image-to-video
// Space and fall back to public WAN 2.2 Spaces if the first one is unavailable.
const configuredSpace = String(process.env.WAN_SPACE_ID || '').trim();
const isOldWan21 = /wan2\.1/i.test(configuredSpace);
const PRIMARY_SPACE = configuredSpace && !isOldWan21
  ? configuredSpace
  : 'Upsampler/wan-2-2-5b-video';
const FALLBACK_SPACES = [
  PRIMARY_SPACE,
  'Upsampler/wan-2-2-14b-text-to-video',
  'icehooo5/wan2-video-generation'
].filter((space, index, list) => space && list.indexOf(space) === index);

const CONFIGURED_ENDPOINT = String(process.env.WAN_ENDPOINT || '').trim();
const HF_TOKEN = process.env.HF_TOKEN || undefined;
const clientPromises = new Map();
const WAN_CLIP_TIMEOUT_MS = 4 * 60 * 1000;

function spaceOrigin(space) {
  const [owner, name] = String(space).split('/');
  if (!owner || !name) return '';
  const normalizedOwner = owner.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return `https://${normalizedOwner}-${normalizedName}.hf.space`;
}

async function getClient(space) {
  if (!clientPromises.has(space)) {
    const origin = spaceOrigin(space);
    clientPromises.set(space, Client.connect(origin, {
      ...(HF_TOKEN ? { token: HF_TOKEN } : {}),
      events: ['status', 'data'],
      space_status: (status) => console.log('[WAN 2.2]', space, status?.status || 'unknown', status?.message || '')
    }).catch(error => {
      clientPromises.delete(space);
      throw error;
    }));
  }
  return clientPromises.get(space);
}

function asRemoteUrl(value, space) {
  if (typeof value !== 'string' || !value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/file=') || value.startsWith('/gradio_api/file=')) return `${spaceOrigin(space)}${value}`;
  return '';
}

function outputReference(data, space) {
  if (data == null) return '';
  if (Array.isArray(data)) {
    for (const value of data) {
      const found = outputReference(value, space);
      if (found) return found;
    }
    return '';
  }
  if (typeof data === 'string') {
    const remote = asRemoteUrl(data, space);
    if (remote) return remote;
    if (data.toLowerCase().endsWith('.mp4')) return data;
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

function parameterName(parameter) {
  return String(parameter?.parameter_name || parameter?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function hasDefault(parameter) {
  return Boolean(parameter?.parameter_has_default);
}

function parameterChoices(parameter) {
  return parameter?.parameter_type?.enum || parameter?.choices || parameter?.enum || [];
}

function preferredModelValue(parameter) {
  const desired = String(process.env.WAN_MODEL || 'Wan2.2').toLowerCase();
  const choices = parameterChoices(parameter);
  if (!Array.isArray(choices)) return null;
  const match = choices.find(choice => {
    const value = typeof choice === 'object' ? (choice.value ?? choice.label ?? '') : choice;
    return String(value).toLowerCase().includes(desired);
  });
  return match == null ? null : (typeof match === 'object' ? (match.value ?? match.label) : match);
}

function buildInputs(endpointInfo, prompt, negative, aspect) {
  const parameters = Array.isArray(endpointInfo?.parameters) ? endpointInfo.parameters : [];
  const portrait = aspect === '9:16';
  const square = aspect === '1:1';
  const height = portrait ? 832 : square ? 624 : 480;
  const width = portrait ? 480 : square ? 624 : 832;
  const defaultSteps = Number(process.env.WAN_STEPS || 4);
  const defaultGuidance = Number(process.env.WAN_GUIDE_SCALE || 5);
  const defaultFrames = Number(process.env.WAN_FRAMES || 73);
  const values = [];

  for (const parameter of parameters) {
    const name = parameterName(parameter);
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
    else if (name === 'model' || name.includes('model_choice') || name.includes('model_id')) {
      value = preferredModelValue(parameter) ?? (hasDefault(parameter) ? parameter.parameter_default : null);
    } else if (name.includes('image') || name.includes('input_video') || name.includes('video')) {
      if (!hasDefault(parameter)) throw new Error(`El endpoint WAN 2.2 seleccionado requiere un archivo (${parameter.label || name}) y no es compatible con texto a vídeo.`);
      value = parameter.parameter_default;
    } else if (hasDefault(parameter)) value = parameter.parameter_default;
    else if (parameter?.type === 'boolean' || parameter?.component === 'Checkbox') value = false;
    else if (parameter?.type === 'number' || parameter?.component === 'Number' || parameter?.component === 'Slider') value = 0;
    else if (parameter?.type === 'string' || parameter?.component === 'Textbox') value = '';
    else value = null;
    values.push(value);
  }
  return values;
}

function chooseEndpoint(api, space) {
  const named = api?.named_endpoints || {};
  const entries = Object.entries(named);
  if (!entries.length) throw new Error(`El Space ${space} no expone endpoints Gradio públicos.`);
  if (CONFIGURED_ENDPOINT && named[CONFIGURED_ENDPOINT]) return [CONFIGURED_ENDPOINT, named[CONFIGURED_ENDPOINT]];

  const ranked = entries
    .filter(([, info]) => Array.isArray(info?.parameters))
    .map(([name, info]) => {
      const names = info.parameters.map(parameterName);
      const hasPrompt = names.some(value => value === 'prompt' || value.includes('prompt'));
      const imageParameters = info.parameters.filter(parameter => {
        const value = parameterName(parameter);
        return value.includes('image') || value.includes('input_video');
      });
      const hasRequiredImage = imageParameters.some(parameter => !hasDefault(parameter));
      const hasVideoReturn = (info.returns || []).some(item => {
        const text = `${item?.label || ''} ${item?.component || ''}`.toLowerCase();
        return text.includes('video') || text.includes('file');
      });
      let score = 0;
      if (hasPrompt) score += 10;
      if (hasVideoReturn) score += 5;
      if (!imageParameters.length) score += 5;
      if (imageParameters.length && !hasRequiredImage) score += 3;
      if (name.includes('generate')) score += 8;
      if (name.includes('t2v')) score += 8;
      if (name === '/predict') score += 1;
      return { name, info, score, hasPrompt, hasRequiredImage };
    })
    .filter(item => item.hasPrompt && !item.hasRequiredImage)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) throw new Error(`El Space ${space} no expone un endpoint WAN 2.2 de texto a vídeo compatible. Endpoints: ${Object.keys(named).join(', ') || 'ninguno'}.`);
  return [ranked[0].name, ranked[0].info];
}

async function submitWan(app, endpoint, inputs, job, space) {
  const submission = app.submit(endpoint, inputs);
  job.gradioJob = submission;
  const deadline = Date.now() + WAN_CLIP_TIMEOUT_MS;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (job.gradioJob === submission) job.gradioJob = null;
      fn(value);
    };
    const timer = setTimeout(() => {
      try { submission.cancel?.(); } catch (_) {}
      finish(reject, Object.assign(new Error('WAN 2.2 tardó más de 4 minutos en producir el clip; generación detenida.'), { code: 'TIMEOUT' }));
    }, WAN_CLIP_TIMEOUT_MS);

    (async () => {
      try {
        for await (const message of submission) {
          if (job.cancelled) {
            try { submission.cancel?.(); } catch (_) {}
            finish(reject, Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' }));
            return;
          }
          if (message?.type === 'status') {
            const stage = String(message.stage || '').toLowerCase();
            const eta = Number(message.eta);
            if (stage === 'pending' || stage === 'generating' || stage === 'processing') {
              job.providerState = stage.toUpperCase();
              job.detail = eta > 0
                ? `WAN 2.2 (${space}): generando clip; ETA aproximada ${Math.ceil(eta)} s…`
                : `WAN 2.2 (${space}): generando el clip…`;
            }
          }
          if (message?.type === 'data') {
            finish(resolve, { data: message.data });
            return;
          }
          if (message?.type === 'status' && message.success === false && String(message.stage || '').toLowerCase() === 'error') {
            finish(reject, new Error(message.message || 'WAN 2.2 reportó un error durante la generación.'));
            return;
          }
        }
        if (!settled && Date.now() >= deadline) finish(reject, Object.assign(new Error('WAN 2.2 agotó el tiempo máximo para este clip.'), { code: 'TIMEOUT' }));
        else if (!settled) finish(reject, new Error('WAN 2.2 cerró la cola sin devolver el vídeo.'));
      } catch (error) {
        finish(reject, error);
      }
    })();
  });
}

export async function generateWanVideo({ prompt, negative, aspect = '16:9', job }) {
  let lastError = null;
  for (const space of FALLBACK_SPACES) {
    try {
      if (job.cancelled) throw Object.assign(new Error('Generación cancelada.'), { code: 'CANCELLED' });
      job.detail = `Conectando con WAN 2.2 (${space})…`;
      const app = await getClient(space);
      const api = await app.view_api();
      const [endpoint, endpointInfo] = chooseEndpoint(api, space);
      const inputs = buildInputs(endpointInfo, prompt, negative, aspect);
      job.providerState = 'PROCESSING';
      job.providerEndpoint = `${space}${endpoint}`;
      job.detail = `WAN 2.2 conectado (${space}, ${endpoint}). Generando el vídeo…`;

      const result = await submitWan(app, endpoint, inputs, job, space);
      const reference = outputReference(result?.data ?? result, space);
      if (!reference) throw new Error(`La respuesta no contiene un vídeo: ${JSON.stringify(result).slice(0, 1200)}`);
      if (/^https?:\/\//i.test(reference)) {
        job.providerState = 'COMPLETED';
        job.detail = `WAN 2.2 terminó (${space}); vídeo preparado para FFmpeg…`;
        return reference;
      }
      throw new Error(`WAN 2.2 devolvió una ruta local no accesible desde Render: ${reference}`);
    } catch (error) {
      lastError = error;
      console.error(`[WAN 2.2] ${space} falló:`, error?.stack || error?.message || error);
      if (error?.code === 'CANCELLED') throw error;
      job.detail = `WAN 2.2 (${space}) no disponible; probando respaldo…`;
    }
  }
  throw new Error(`WAN 2.2 no pudo conectarse a ningún backend público. Último error: ${lastError?.message || lastError || 'desconocido'}`);
}

export function cancelWanVideo(job) {
  job.cancelled = true;
  try { job.gradioJob?.cancel?.(); } catch (_) {}
  job.gradioJob = null;
}
