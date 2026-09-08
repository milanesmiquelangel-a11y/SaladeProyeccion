(() => {
  const STORAGE = { projects: 'salaProjects', history: 'salaHistory' };
  const $ = (selector) => document.querySelector(selector);
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const promptInput = $('#prompt');
  const negativeInput = $('#negative');
  const projectNameInput = $('#projectName');
  const aspectInput = $('#aspect');
  const durationInput = $('#duration');
  const resolutionInput = $('#resolution');
  const frameRateInput = $('#frameRate');
  const history = $('#history');
  const cancelBtn = $('#cancelBtn');
  const loadingState = $('#loadingState');
  const statusText = $('#statusText');
  const loadingTitle = $('#loadingTitle');
  const loadingDetail = $('#loadingDetail');
  const newProjectBtn = $('#newProjectBtn');
  const videoForm = $('#videoForm');

  function currentJob() {
    const projects = readJson(STORAGE.projects, []);
    return projects.find((p) => p.status === 'procesando' && (p.sequenceId || p.requestId)) || null;
  }

  function refreshCancelButton() {
    if (!cancelBtn) return;
    cancelBtn.disabled = !currentJob();
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
    const target = document.querySelector(`#view-${name}`);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  }

  // Clear only the visible editor. Never fire input/change events here because
  // app.js uses those events for autosave and could recreate a blank draft.
  function clearCreationForm() {
    if (!videoForm || !promptInput) return;
    videoForm.reset();
    projectNameInput.value = '';
    promptInput.value = '';
    negativeInput.value = '';
    aspectInput.value = '16:9';
    durationInput.value = '5';
    resolutionInput.value = 'standard';
    frameRateInput.value = '24';
    promptInput.blur();
    clearResultForNewProject();
    const counter = $('#charCount');
    if (counter) counter.textContent = '0 / 4000';
  }

  function clearResultForNewProject() {
    const player = $('#videoPlayer');
    player?.pause?.();
    player?.removeAttribute('src');
    player?.load?.();
    player?.classList.add('hidden');
    $('#videoLink')?.classList.add('hidden');
    $('#videoLink')?.removeAttribute('href');
    $('#errorBox')?.classList.add('hidden');
    $('#emptyState')?.classList.remove('hidden');
    loadingState?.classList.add('hidden');
    if (statusText) statusText.textContent = 'Sin producción activa';
  }

  function loadPreviousPrompt(item) {
    if (!item || !promptInput) return;

    clearCreationForm();
    projectNameInput.value = item.name || 'Nueva producción';
    promptInput.value = item.prompt || '';
    negativeInput.value = item.negative || '';
    aspectInput.value = item.aspect || '16:9';
    durationInput.value = String(item.duration || 5);
    resolutionInput.value = item.resolution || 'standard';
    frameRateInput.value = String(item.frameRate || 24);

    // Update only the counter; do not trigger autosave while loading a history item.
    const counter = $('#charCount');
    if (counter) counter.textContent = `${promptInput.value.length} / 4000`;
    showView('crear');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    promptInput.focus();
  }

  function itemFromHistory(index) {
    return readJson(STORAGE.history, [])[Number(index)] || null;
  }

  history?.addEventListener('click', (event) => {
    const button = event.target.closest('.rerun-history');
    if (!button) return;
    loadPreviousPrompt(itemFromHistory(button.dataset.index));
  });

  newProjectBtn?.addEventListener('click', () => {
    clearCreationForm();
    showView('crear');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    promptInput?.focus();
  });

  // Prevent Chrome/Android page restoration from putting the previous prompt back.
  // This affects only the visible editor, never saved projects/history.
  const clearOnPageShow = () => {
    setTimeout(() => clearCreationForm(), 0);
  };
  window.addEventListener('pageshow', clearOnPageShow);
  clearOnPageShow();

  cancelBtn?.addEventListener('click', async () => {
    const job = currentJob();
    if (!job) return;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Deteniendo…';
    try {
      const endpoint = job.sequenceId
        ? `/api/video/sequence/${encodeURIComponent(job.sequenceId)}/cancel`
        : `/api/video/cancel/${encodeURIComponent(job.requestId)}`;
      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo detener la generación.');
      const projects = readJson(STORAGE.projects, []);
      const index = projects.findIndex((p) => p.id === job.id);
      if (index >= 0) {
        projects[index] = { ...projects[index], status: 'cancelado', updatedAt: Date.now() };
        writeJson(STORAGE.projects, projects);
      }
      if (loadingState) loadingState.classList.add('hidden');
      if (statusText) statusText.textContent = 'Generación detenida';
      if (loadingTitle) loadingTitle.textContent = 'Generación detenida';
      if (loadingDetail) loadingDetail.textContent = 'Puedes volver a generarla desde Actividad reciente.';
      cancelBtn.textContent = '⏹ Detener generación';
      refreshCancelButton();
    } catch (error) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = '⏹ Detener generación';
      alert(error.message || 'No se pudo detener la generación.');
    }
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = String(args[0]?.url || args[0] || '');
      if (response.ok && (url.includes('/api/video/generate') || url.includes('/api/video/sequence'))) {
        const data = await response.clone().json();
        const projects = readJson(STORAGE.projects, []);
        const latest = projects[0];
        if (latest && data.request_id && url.includes('/api/video/generate')) {
          projects[0] = { ...latest, requestId: data.request_id, status: 'procesando', updatedAt: Date.now() };
          writeJson(STORAGE.projects, projects);
        }
        if (latest && data.job_id && url.includes('/api/video/sequence')) {
          projects[0] = { ...latest, sequenceId: data.job_id, status: 'procesando', updatedAt: Date.now() };
          writeJson(STORAGE.projects, projects);
        }
      }
    } catch {}
    refreshCancelButton();
    return response;
  };

  const timer = setInterval(() => {
    const items = readJson(STORAGE.history, []);
    history?.querySelectorAll('.history-item').forEach((row, index) => {
      if (row.querySelector('.rerun-history') || !items[index]?.prompt) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button rerun-history';
      button.dataset.index = String(index);
      button.textContent = '↻ Cargar prompt';
      button.title = 'Cargar este prompt en el editor';
      row.appendChild(button);
    });
    refreshCancelButton();
  }, 500);
  setTimeout(() => clearInterval(timer), 60000);
  refreshCancelButton();
})();