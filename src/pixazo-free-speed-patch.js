const nativeFetch = globalThis.fetch.bind(globalThis);

// The current Pixazo LTX 2.5 Free API documents these parameter names and
// exposes the inference-step setting. The previous integration sent older
// aliases and left inference at the slower default. Keep this patch scoped to
// the free LTX endpoint so other providers/routes are untouched.
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!url.includes('/ltx-video/v1/text-to-video') && !url.includes('/ltx-video/v1/image-to-video')) {
    return nativeFetch(input, init);
  }

  let options = { ...init };
  try {
    const original = JSON.parse(String(init.body || '{}'));
    const aspect = original.aspect || '16:9';
    const resolution = aspect === '9:16' ? 'portrait_16_9' : aspect === '1:1' ? 'square' : 'landscape_16_9';
    const fps = Number(original.frameRate) === 30 ? 30 : 24;
    const body = {
      prompt: String(original.prompt || '').slice(0, 4000),
      negative: String(original.negative || '').slice(0, 4000),
      num_frames: 121,
      resolution,
      frames_per_second: fps,
      num_inference_steps: 8,
      guidance_scale: 1,
      generate_audio: false
    };
    if (original.image_url) {
      body.image_url = original.image_url;
      body.image_strength = Number.isFinite(Number(original.strength)) ? Number(original.strength) : 1;
    }
    options = { ...options, body: JSON.stringify(body) };
  } catch (_) {
    // If the body cannot be parsed, leave the request untouched so the normal
    // error handling can report the provider response.
  }
  return nativeFetch(input, options);
};
