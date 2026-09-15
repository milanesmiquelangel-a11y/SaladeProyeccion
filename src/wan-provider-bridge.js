import { randomUUID } from 'node:crypto';
import { generateWanVideo } from './wan-video-provider.js';

// Keep the existing generation pipeline, billing, audio and FFmpeg intact.
// Only the provider transport is replaced: requests that the old pipeline
// sends to Pixazo are executed by WAN 2.1 instead.
const nativeFetch = globalThis.fetch.bind(globalThis);
const providerJobs = new Map();
const WAN_TEXT_URL = '/ltx-video/v1/text-to-video';
const WAN_IMAGE_URL = '/ltx-video/v1/image-to-video';
const WAN_STATUS_URL = '/v2/requests/status/';

process.env.PIXAZO_API_KEY ||= 'wan-provider-bridge';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function isProviderUrl(url) {
  return url.includes('/ltx-video/v1/text-to-video') || url.includes('/ltx-video/v1/image-to-video');
}

function startWan(body) {
  const id = randomUUID();
  const record = { id, status: 'QUEUED', output: '', error: '', createdAt: Date.now() };
  providerJobs.set(id, record);

  const aspect = body.aspect || (body.resolution === 'portrait_16_9' ? '9:16' : body.resolution === 'square' ? '1:1' : '16:9');
  generateWanVideo({
    prompt: String(body.prompt || '').slice(0, 4000),
    negative: String(body.negative || '').slice(0, 4000),
    aspect,
    job: record
  }).then(url => {
    record.status = 'COMPLETED';
    record.output = url;
  }).catch(error => {
    record.status = 'FAILED';
    record.error = error?.message || 'WAN 2.1 no pudo completar la generación.';
  });

  return id;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';

  if (isProviderUrl(url) && String(init.method || 'GET').toUpperCase() === 'POST') {
    let body = {};
    try { body = JSON.parse(String(init.body || '{}')); } catch (_) {}
    const id = startWan(body);
    return response({ request_id: id });
  }

  if (url.includes(WAN_STATUS_URL)) {
    const id = decodeURIComponent(url.split(WAN_STATUS_URL).pop().split('?')[0]);
    const record = providerJobs.get(id);
    if (!record) return response({ status: 'ERROR', error: 'No se encontró la generación WAN.' }, 404);
    if (record.status === 'COMPLETED') return response({ status: 'COMPLETED', output: { media_url: record.output } });
    if (record.status === 'FAILED') return response({ status: 'FAILED', error: record.error });
    return response({ status: record.providerState || 'PROCESSING' });
  }

  return nativeFetch(input, init);
};

await import('./final-generation-bootstrap.js');
