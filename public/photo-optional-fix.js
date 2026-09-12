// Finalize the optional-photo UX and make no-photo narration real.
(() => {
  const imageInput = document.querySelector('#imageInput');
  const form = document.querySelector('#videoForm');
  const audioTextInput = document.querySelector('#audioText');
  const audioLanguageInput = document.querySelector('#audioLanguage');
  const promptInput = document.querySelector('#prompt');
  const negativeInput = document.querySelector('#negative');
  const aspectInput = document.querySelector('#aspect');
  const durationInput = document.querySelector('#duration');
  const resolutionInput = document.querySelector('#resolution');
  const frameRateInput = document.querySelector('#frameRate');
  const generateBtn = document.querySelector('#generateBtn');
  const cancelBtn = document.querySelector('#cancelBtn');
  const projectNameInput = document.querySelector('#projectName');
  const loadingState = document.querySelector('#loadingState');
  const loadingTitle = document.querySelector('#loadingTitle');
  const loadingDetail = document.querySelector('#loadingDetail');
  const emptyState = document.querySelector('#emptyState');
  const videoPlayer = document.querySelector('#videoPlayer');
  const videoLink = document.querySelector('#videoLink');
  const errorBox = document.querySelector('#errorBox');
  const statusText = document.querySelector('#statusText');
  if (imageInput) { imageInput.removeAttribute('required'); imageInput.required = false; }
  if (!form || !audioTextInput || !imageInput) return;

  let jobId = null;
  let timer = null;
  const json = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  function project() {
    return {
      id: crypto.randomUUID(),
      name: (projectNameInput.value.trim() || 'AI video').slice(0, 80),
      prompt: promptInput.value.trim(),
      audioText: audioTextInput.value.trim(),
      audioLanguage: audioLanguageInput.value || 'en',
      negative: negativeInput.value.trim(),
      aspect: aspectInput.value,
      duration: Number(durationInput.value),
      resolution: resolutionInput.value,
      frameRate: Number(frameRateInput.value),
      createdAt: Date.now(), updatedAt: Date.now(), status: 'procesando'
    };
  }

  function saveProject(p, extra = {}) {
    const projects = json('salaProjects', []);
    projects.unshift({ ...p, ...extra, updatedAt: Date.now() });
    save('salaProjects', projects.slice(0, 30));
  }

  function saveHistory(p, url) {
    const items = json('salaHistory', []);
    items.unshift({ name: p.name, prompt: p.prompt, audioText: p.audioText, audioLanguage: p.audioLanguage, aspect: p.aspect, duration: p.duration, date: Date.now(), status: 'completado', url });
    save('salaHistory', items.slice(0, 20));
  }

  function setLoading(title, detail) {
    emptyState.classList.add('hidden'); loadingState.classList.remove('hidden');
    loadingTitle.textContent = title; loadingDetail.textContent = detail; statusText.textContent = 'Procesando';
  }

  function fail(message) {
    clearTimeout(timer); loadingState.classList.add('hidden'); errorBox.textContent = message; errorBox.classList.remove('hidden'); statusText.textContent = 'Error';
    generateBtn.disabled = false; cancelBtn.disabled = true; jobId = null;
  }

  async function poll(id, p) {
    jobId = id; clearTimeout(timer);
    try {
      const response = await fetch(`/api/video/sequence/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar la generación.');
      if (data.status === 'COMPLETED' && data.outputUrl) {
        videoPlayer.src = data.outputUrl; videoPlayer.classList.remove('hidden');
        videoLink.href = data.outputUrl; videoLink.classList.remove('hidden');
        loadingState.classList.add('hidden'); statusText.textContent = p.audioText ? 'Completado · vídeo + audio' : 'Completado';
        saveHistory(p, data.outputUrl); saveProject(p, { status: 'completado', sequenceId: id, url: data.outputUrl });
        generateBtn.disabled = false; cancelBtn.disabled = true; jobId = null; return;
      }
      if (data.status === 'ERROR') throw new Error(data.detail || 'La generación no pudo completarse.');
      if (data.status === 'CANCELLED') throw new Error(data.detail || 'Generación cancelada.');
      setLoading('Generando vídeo + audio…', data.detail || 'Procesando tu prompt y preparando la narración.');
      timer = setTimeout(() => poll(id, p), 5000);
    } catch (e) { fail(e.message || 'No se pudo completar la generación.'); }
  }

  form.addEventListener('submit', async (event) => {
    if (imageInput.files?.length || !audioTextInput.value.trim()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    clearTimeout(timer); errorBox.classList.add('hidden'); generateBtn.disabled = true; cancelBtn.disabled = false;
    const p = project();
    try {
      setLoading('Preparando vídeo + audio…', 'Tu prompt controla el vídeo y tu texto controla la narración.');
      const response = await fetch('/api/video/sequence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p.prompt, negative: p.negative, aspect: p.aspect, duration: p.duration, resolution: p.resolution, frameRate: p.frameRate, audioText: p.audioText, audioLanguage: p.audioLanguage })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la generación.');
      saveProject(p, { sequenceId: data.job_id });
      await poll(data.job_id, p);
    } catch (e) { fail(e.message || 'No se pudo iniciar la generación.'); }
  }, true);

  cancelBtn?.addEventListener('click', async (event) => {
    if (!jobId) return;
    event.preventDefault(); event.stopImmediatePropagation(); clearTimeout(timer);
    await fetch(`/api/video/sequence/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(() => {});
    jobId = null; loadingState.classList.add('hidden'); statusText.textContent = 'Cancelado'; generateBtn.disabled = false; cancelBtn.disabled = true;
  }, true);
})();
