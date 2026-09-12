// Compatibility layer for Pixazo's free LTX Video endpoint.
// Keeps the existing API route stable while ensuring the provider receives
// the user's actual scene instead of legacy sequence/automotive instructions.
const nativeFetch = globalThis.fetch.bind(globalThis);
const TEXT_TO_VIDEO = 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';

function extractUserScene(userPrompt) {
  const text = String(userPrompt || '').trim();
  if (!text) return '';
  const marker = text.search(/\n\s*Scene\s+\d+\s+of\s+\d+\./i);
  return marker >= 0 ? text.slice(0, marker).trim() : text;
}

function buildPrompt(userPrompt) {
  const text = extractUserScene(userPrompt);
  return [
    'Generate exactly the scene requested by the user.',
    'The main subject, setting, and action described by the user are mandatory.',
    'Do not replace the main subject with another subject.',
    'Do not invent a different story or add unrelated people, animals, vehicles, or objects.',
    'Keep the same main subject and setting throughout the entire clip.',
    'One clear action, coherent composition, natural motion, realistic anatomy and physics.',
    'Photorealistic cinematic video, sharp detail, natural lighting, stable temporal consistency, high visual quality.',
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
