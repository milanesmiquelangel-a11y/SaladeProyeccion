import { randomUUID } from 'node:crypto';
import { generateWanVideo } from './wan-video-provider.js';

// Keep the existing generation pipeline, billing, audio and FFmpeg intact.
// Only the provider transport is replaced: requests that the old pipeline
// sends to Pixazo are executed by the WAN 2.2 provider.
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