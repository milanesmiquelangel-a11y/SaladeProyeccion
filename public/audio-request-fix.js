// AUDIO-ONLY INTEGRATION.
// Keeps the existing video-generation requests and polling behavior intact.
(() => {
  const nativeFetch = window.fetch.bind(window);
  const targets = ['/api/video/sequence', '/api/video/generate'];
  const pendingAudio = new Map();
  const processedAudio = new Set();
  const readJson = async (response) => response.clone().json().catch(() => ({}));
  const keyFromResponse = (data) => data?.request_id || data?.requestId || data?.job_id || data?.jobId || '';

  function rememberAudio(key) {
    if (!key) return;
    const text = String(document.querySelector('#audioText')?.value || '').trim();
    if (!text) return;
    pendingAudio.set(String(key), { text: text.slice(0, 4000), language: String(document.querySelector('#audioLanguage')?.value || 'en').trim() || 'en', duration: Math.max(1, Number(document.querySelector('#duration')?.value) || 5) });
  }

  function showAudioStatus() {
    const loading = document.querySelector('#loadingState');
    const title = document.querySelector('#loadingTitle');
    const detail = document.querySelector('#loadingDetail');
    const status = document.querySelector('#statusText');
    if (loading) loading.classList.remove('hidden');
    if (title) title.textContent = 'Añadiendo audio natural…';
    if (detail) detail.textContent = 'Generando la narración y sincronizándola con el vídeo…';
    if (status) status.textContent = 'Procesando audio';
  }

  async function addNaturalAudio(key, videoUrl, audio) {
    if (!videoUrl || !audio?.text || processedAudio.has(String(key))) return;
    processedAudio.add(String(key));
    try {
      showAudioStatus();
      const audioResponse = await nativeFetch('/api/audio/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: audio.text, language: audio.language }) });
      const audioData = await audioResponse.json().catch(() => ({}));
      if (!audioResponse.ok || !audioData.url) throw new Error(audioData.error || 'No se pudo generar la narración.');
      const muxResponse = /^https:\/\//i.test(videoUrl)
        ? await nativeFetch('/api/audio/mux-remote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl, audio: audioData.url, durationSeconds: audio.duration }) })
        : await nativeFetch('/api/audio/mux', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video: videoUrl.split('/').pop().split('?')[0], audio: audioData.url.split('/').pop().split('?')[0], durationSeconds: audio.duration }) });
      const muxData = await muxResponse.json().catch(() => ({}));
      if (!muxResponse.ok || !muxData.url) throw new Error(muxData.error || 'No se pudo integrar el audio en el vídeo.');
      const finalUrl = `${muxData.url}?audio=${Date.now()}`;
      const player = document.querySelector('#videoPlayer');
      const link = document.querySelector('#videoLink');
      if (player) { player.src = finalUrl; player.classList.remove('hidden'); player.load(); }
      if (link) { link.href = finalUrl; link.classList.remove('hidden'); }
      document.querySelector('#loadingState')?.classList.add('hidden');
      const status = document.querySelector('#statusText'); if (status) status.textContent = 'Completado con audio';
      try {
        const projects = JSON.parse(localStorage.getItem('salaProjects') || '[]');
        const history = JSON.parse(localStorage.getItem('salaHistory') || '[]');
        for (const item of projects) if (item.requestId === String(key) || item.sequenceId === String(key)) item.url = finalUrl;
        for (const item of history) if (!item.url || item.url === videoUrl) item.url = finalUrl;
        localStorage.setItem('salaProjects', JSON.stringify(projects)); localStorage.setItem('salaHistory', JSON.stringify(history));
      } catch {}
    } catch (error) {
      processedAudio.delete(String(key));
      document.querySelector('#loadingState')?.classList.add('hidden');
      const status = document.querySelector('#statusText'); if (status) status.textContent = 'Vídeo listo';
      console.warn('[Audio] El vídeo está listo; no se pudo añadir la narración:', error);
    } finally { pendingAudio.delete(String(key)); }
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    if (method === 'POST' && targets.some(route => url.includes(route))) {
      if (!init.body || typeof init.body !== 'string') return nativeFetch(input, init);
      try {
        const body = JSON.parse(init.body);
        const text = String(document.querySelector('#audioText')?.value || '').trim();
        const language = String(document.querySelector('#audioLanguage')?.value || 'en').trim() || 'en';
        if (text) { body.audioText = text.slice(0, 4000); body.audioLanguage = language; }
        const response = await nativeFetch(input, { ...init, body: JSON.stringify(body) });
        const data = await readJson(response); if (response.ok) rememberAudio(keyFromResponse(data));
        return response;
      } catch { return nativeFetch(input, init); }
    }
    const isStatus = method === 'GET' && (url.includes('/api/video/status/') || url.includes('/api/video/sequence/'));
    if (!isStatus) return nativeFetch(input, init);
    const response = await nativeFetch(input, init);
    const data = await readJson(response);
    if (response.ok) {
      const state = String(data.status || data.state || '').toUpperCase();
      const key = decodeURIComponent(url.split('/').pop().split('?')[0]);
      const complete = state === 'COMPLETED' || state === 'SUCCEEDED' || Boolean(data.output?.media_url) || Boolean(data.outputUrl);
      if (complete && pendingAudio.has(key)) void addNaturalAudio(key, data.outputUrl || data.output?.media_url, pendingAudio.get(key));
    }
    return response;
  };
})();
