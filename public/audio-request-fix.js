// Ensure narration fields reach every video generation route.
// This fixes the main prompt-to-video handler, which previously omitted audioText/audioLanguage.
(() => {
  const nativeFetch = window.fetch.bind(window);
  const targets = ['/api/video/sequence', '/api/video/generate'];

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!targets.some((route) => url.includes(route)) || !init.body || typeof init.body !== 'string') {
      return nativeFetch(input, init);
    }
    try {
      const body = JSON.parse(init.body);
      const audioText = String(document.querySelector('#audioText')?.value || '').trim();
      const audioLanguage = String(document.querySelector('#audioLanguage')?.value || 'en').trim() || 'en';
      if (audioText) {
        body.audioText = audioText.slice(0, 4000);
        body.audioLanguage = audioLanguage;
      }
      return nativeFetch(input, { ...init, body: JSON.stringify(body) });
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
