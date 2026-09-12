// Compatibility layer for Pixazo's free LTX Video endpoint.
// Keeps the existing API route stable while using the provider's documented
// controls for exact 5-second output and stronger prompt adherence.
const nativeFetch = globalThis.fetch.bind(globalThis);
const TEXT_TO_VIDEO = 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';

function buildPrompt(userPrompt) {
  const text = String(userPrompt || '').trim();
  return [
    'Generate ONLY the scene described below.',
    'The main subject and action in the user description are mandatory.',
    'Do not substitute the subject with a person, vehicle, animal, object, or unrelated scene.',
    'Do not invent a different story or change the requested action.',
    'Keep the same subject identity and environment throughout the clip.',
    'Photorealistic cinematic video, sharp details, natural lighting, realistic motion, realistic anatomy and physics, clean high-quality image.',
    `USER SCENE: ${text}`
  ].join(' ');
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!String(url).startsWith(TEXT_TO_VIDEO)) return nativeFetch(input, init);

  let body = {};
  try { body = JSON.parse(init.body || '{}'); } catch {}

  const requestedFrames = Number(body.num_frames);
  const frames = [121, 97, 225].includes(requestedFrames) ? requestedFrames : 121;
  const aspect = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '4:5', '2:3', '3:2'].includes(body.aspect)
    ? body.aspect
    : '16:9';

  const providerBody = {
    prompt: buildPrompt(body.prompt),
    seed: Math.floor(Math.random() * 2147483647),
    aspect,
    width: 1280,
    height: 720,
    num_frames: frames,
    frame_rate: Number(body.frame_rate) || 24,
    enhance_prompt: true
  };

  return nativeFetch(TEXT_TO_VIDEO, {
    ...init,
    body: JSON.stringify(providerBody),
    headers: {
      ...(init.headers || {}),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
};
