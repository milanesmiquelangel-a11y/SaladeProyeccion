// AUDIO-ONLY INTEGRATION.
// The video-generation pipeline is left untouched. This layer observes completed
// video jobs and adds a natural sound-effects/ambience track derived from the prompt.
(() => {
  const nativeFetch = window.fetch.bind(window);
  const targets = ['/api/video/sequence', '/api/video/generate'];
  const pendingAudio = new Map();
  const processedAudio = new Set();

  const readJson = async (response) => response.clone().json().catch(() => ({}));
  const keyFromResponse = (data) => data?.request_id || data?.requestId || data?.job_id || data?.jobId || '';

  function rememberAudio(key, body) {
    if (!key) return;
    const prompt = String(body?.prompt || document.querySelector('#prompt')?.value || '').trim();
    if (!prompt) return;
    pendingAudio.set(String(key), {
      prompt: prompt.slice(0, 4000),
      duration: Math.min(60, Math.max(1, Number(body?.duration || document.querySelector('#duration')?.value) || 5))
    });
  }

  function showAudioStatus() {
    const loading = document.querySelector('#loadingState');
    const title = document.querySelector('#loadingTitle');
    const detail = document.querySelector('#loadingDetail');
    const status = document.querySelector('#statusText');
    if (loading) loading.classList.remove('hidden');
    if (title) title.textContent = 'Añadiendo sonido natural…';
    if (detail) detail.textContent = 'Creando ambiente y efectos de sonido según la escena…';
    if (status) status.textContent = 'Procesando sonido';
  }

  async function addNaturalAudio(key, videoUrl, audio) {
    if (!videoUrl || !audio?.prompt || processedAudio.has(String(key))) return;
    processedAudio.add(String(key));
    try {
      showAudioStatus();
      const audioResponse = await nativeFetch('/api/audio/natural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: audio.prompt, durationSeconds: audio.duration })
      });
      const audioData = await audioResponse.json().catch(() => ({}));
      if (!audioResponse.ok || !audioData.url) throw new Error(audioData.error || 'No se pudo generar el sonido natural.');

      let muxResponse;
      if (/^https:\/\//i.test(videoUrl)) {
        muxResponse = await nativeFetch('/api/audio/mux-remote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl, audio: audioData.url, durationSeconds: audio.duration })
        });
      } else {
        muxResponse = await nativeFetch('/api/audio/mux', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video: videoUrl.split('/').pop().split('?')[0], audio: audioData.url.split('/').pop().split('?')[0], durationSeconds: audio.duration })
        });
      }
      const muxData = await muxResponse.json().catch(() => ({}));
      if (!muxResponse.ok || !muxData.url) throw new Error(muxData.error || 'No se pudo integrar el sonido natural en el vídeo.');

      const finalUrl = `${muxData.url}?audio=${Date.now()}`;
      const player = document.querySelector('#videoPlayer');
      const link = document.querySelector('#videoLink');
      if (player) { player.src = finalUrl; player.classList.remove('hidden'); player.load(); }
      if (link) { link.href = finalUrl; link.classList.remove('hidden'); }
      const loading = document.querySelector('#loadingState');
      const status = document.querySelector('#statusText');
      if (loading) loading.classList.add('hidden');
      if (status) status.textContent = 'Completado · sonido natural';

      try {
        const projects = JSON.parse(localStorage.getItem('salaProjects') || '[]');
        const history = JSON.parse(localStorage.getItem('salaHistory') || '[]');
        for (const item of projects) if (item.requestId === String(key) || item.sequenceId === String(key)) item.url = finalUrl;
        for (const item of history) if (!item.url || item.url === videoUrl) item.url = finalUrl;
        localStorage.setItem('salaProjects', JSON.stringify(projects));
        localStorage.setItem('salaHistory', JSON.stringify(history));
      } catch {}
    } catch (error) {
      // Audio is additive: a sound-generation failure never invalidates a completed video.
      processedAudio.delete(String(key));
      const loading = document.querySelector('#loadingState');
      const status = document.querySelector('#statusText');
      if (loading) loading.classList.add('hidden');
      if (status) status.textContent = 'Vídeo listo';
      console.warn('[Audio] El vídeo está listo; no se pudo añadir el sonido natural:', error);
    } finally {
      pendingAudio.delete(String(key));
    }
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init.method || input?.method || 'GET').toUpperCase();

    if (method === 'POST' && targets.some((route) => url.includes(route))) {
      const response = await nativeFetch(input, init);
      if (response.ok && init.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          const data = await readJson(response);
          rememberAudio(keyFromResponse(data), body);
        } catch {}
      }
      return response;
    }

    const isStatus = method === 'GET' && (url.includes('/api/video/status/') || url.includes('/api/video/sequence/'));
    if (!isStatus) return nativeFetch(input, init);

    const response = await nativeFetch(input, init);
    const data = await readJson(response);
    if (response.ok) {
      const state = String(data.status || data.state || '').toUpperCase();
      const key = decodeURIComponent(url.split('/').pop().split('?')[0]);
      const complete = state === 'COMPLETED' || state === 'SUCCEEDED' || Boolean(data.output?.media_url) || Boolean(data.outputUrl);
      if (complete && pendingAudio.has(key)) {
        const videoUrl = data.outputUrl || data.output?.media_url;
        void addNaturalAudio(key, videoUrl, pendingAudio.get(key));
      }
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(state)) pendingAudio.delete(key);
    }
    return response;
  };
})();
