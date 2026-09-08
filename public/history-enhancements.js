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

  // Always start a fresh creation with an empty form. Saved projects/history are kept.
  function clearCreationForm() {
    if (!promptInput) return;
    projectNameInput.value = '';
    promptInput.value = '';
    negativeInput.value = '';
    aspectInput.value = '16:9';
    durationInput.value = '5';
    resolutionInput.value = 'standard';
    frameRateInput.value = '24';
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    clearResultForNewProject();
  }

  function clearResultForNewProject() {
    document.querySelector('#videoPlayer')?.removeAttribute('src');
    document.querySelector('#videoPlayer')?.classList.add('hidden');
    document.querySelector('#videoLink')?.classList.add('hidden');
    document.querySelector('#errorBox')?.classList.add('hidden');
    document.querySelector('#emptyState')?.classList.remove('hidden');
    loadingState?.classList.add('hidden');
    if (statusText) statusText.textContent = 'Sin producción activa';
  }

  function loadPreviousPrompt(item) {
    if (!item || !promptInput) return;

    // Clear first so no text from the prompt currently on screen can remain.
    clearCreationForm();

    projectNameInput.value = item.name || 'Nueva producción';
    promptInput.value = item.prompt || '';
    negativeInput.value = item.negative || '';
    aspectInput.value = item.aspect || '16:9';
    durationInput.value = String(item.duration || 5);
    resolutionInput.value = item.resolution || 'standard';
    frameRateInput.value = String(item.frameRate || 24);

    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    showView('crear');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    promptInput.focus();
  }

  function itemFromHistory(index) {
    return readJson(STORAGE.history, [])[Number(index)] || null;
  }

  // Load a previous prompt with one tap. The prompt is copied back into the editor,
  // not merely displayed in the history entry.
  history?.addEventListener('click', (event) => {
    const button = event.target.closest('.rerun-history');
    if (!button) return;
    loadPreviousPrompt(itemFromHistory(button.dataset.index));
  });

  // A new project explicitly clears the editor without deleting saved history.
  newProjectBtn?.addEventListener('click', () => {
    clearCreationForm();
    showView('crear');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    promptInput?.focus();
  });

  // On a fresh page load, do not resurrect the last prompt from browser form state.
  // This does not touch saved projects or history.
  clearCreationForm();

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

  // Capture IDs returned by the existing generator so the stop button can act on them.
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

  // Add a clear "Cargar prompt" action to every history item.
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
