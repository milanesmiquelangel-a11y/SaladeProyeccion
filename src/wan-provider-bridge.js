import { randomUUID } from 'node:crypto';
import { generateWanVideo } from './wan-video-provider.js';

// Compatibility transport: the legacy generation pipeline still uses the
// Pixazo/LTX HTTP contract. Intercept BOTH relative and absolute legacy URLs
// so every generation path (including 10/15/30/60s continuity) reaches WAN 2.2.
const nativeFetch = globalThis.fetch.bind(globalThis);
const providerJobs = new Map();
const WAN_TEXT_PATH = '/ltx-video/v1/text-to-video';
const WAN_IMAGE_PATH = '/ltx-video/v1/image-to-video';
const WAN_STATUS_PATH = '/v2/requests/status/';

process.env.PIXAZO_API_KEY ||= 'wan-provider-bridge';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function isTextProviderUrl(url) {
  return String(url).includes(WAN_TEXT_PATH);
}

function isImageProviderUrl(url) {
  return String(url).includes(WAN_IMAGE_PATH);
}

function isStatusUrl(url) {
  return String(url).includes(WAN_STATUS_PATH);
}

function startWan(body) {
  const id = randomUUID();
  const record = {
    id,
    status: 'QUEUED',
    output: '',
    error: '',
    createdAt: Date.now(),
    providerState: 'QUEUED',
    cancelled: false
  };
  providerJobs.set(id, record);

  const aspect = body.aspect || (body.resolution === 'portrait_16_9' ? '9:16' : body.resolution === 'square' ? '1:1' : '16:9');
  generateWanVideo({
    prompt: String(body.prompt || '').slice(0, 4000),
    negative: String(body.negative || '').slice(0, 4000),
    aspect,
    job: record
  }).then(url => {
    if (record.cancelled) return;
    record.status = 'COMPLETED';
    record.providerState = 'COMPLETED';
    record.output = url;
  }).catch(error => {
    if (record.cancelled) return;
    record.status = 'FAILED';
    record.providerState = 'FAILED';
    record.error = error?.message || 'WAN 2.2 no pudo completar la generación.';
  });

  return id;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = String(init.method || input?.method || 'GET').toUpperCase();

  // Intercept absolute Pixazo URLs as well as the relative compatibility URLs.
  if ((isTextProviderUrl(url) || isImageProviderUrl(url)) && method === 'POST') {
    let body = {};
    try { body = JSON.parse(String(init.body || '{}')); } catch (_) {}
    const id = startWan(body);
    return response({ request_id: id });
  }

  if (isStatusUrl(url) && method === 'GET') {
    const marker = String(url).split(WAN_STATUS_PATH).pop().split('?')[0];
    const id = decodeURIComponent(marker);
    const record = providerJobs.get(id);
    if (!record) return response({ status: 'ERROR', error: 'No se encontró la generación WAN 2.2.' }, 404);
    if (record.status === 'COMPLETED') return response({ status: 'COMPLETED', output: { media_url: record.output } });
    if (record.status === 'FAILED') return response({ status: 'FAILED', error: record.error });
    return response({ status: record.providerState || 'PROCESSING' });
  }

  return nativeFetch(input, init);
};
