// Reliable Stop button for both 5-second and sequence generations.
// The main app keeps request IDs in localStorage, so this fix can cancel
// the active server job without depending on private variables in app.js.
(() => {
  const cancelBtn = document.querySelector('#cancelBtn');
  const generateBtn = document.querySelector('#generateBtn');
  const loadingState = document.querySelector('#loadingState');
  const statusText = document.querySelector('#statusText');
  const errorBox = document.querySelector('#errorBox');
  const form = document.querySelector('#videoForm');
  if (!cancelBtn || !generateBtn) return;

  const CANCEL_KEY = 'salaGenerationCanceling';
  const PROJECTS_KEY = 'salaProjects';

  const readProjects = () => {
    try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); }
    catch { return []; }
  };

  const activeProject = () => readProjects()
    .filter(p => p && p.status === 'procesando' && (p.requestId || p.sequenceId))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;

  const cancelled = () => {
    try { return JSON.parse(sessionStorage.getItem(CANCEL_KEY) || 'null'); }
    catch { return null; }
  };

  const setCancelled = (value) => {
    try {
      if (value) sessionStorage.setItem(CANCEL_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(CANCEL_KEY);
    } catch {}
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const marker = cancelled();
    if (marker && ((marker.requestId && url.includes(`/api/video/status/${encodeURIComponent(marker.requestId)}`)) ||
                   (marker.sequenceId && url.includes(`/api/video/sequence/${encodeURIComponent(marker.sequenceId)}`)))) {
      return new Response(JSON.stringify({ status: 'CANCELLED', detail: 'Generación detenida por el usuario.', error: 'Generación cancelada.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
    return originalFetch(input, init);
  };

  form?.addEventListener('submit', () => setCancelled(null), true);

  cancelBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const project = activeProject();
    if (!project) {
      cancelBtn.disabled = true;
      return;
    }

    cancelBtn.disabled = true;
    statusText.textContent = 'Cancelando';
    if (errorBox) { errorBox.classList.add('hidden'); errorBox.textContent = ''; }
    setCancelled({ requestId: project.requestId || '', sequenceId: project.sequenceId || '' });

    const endpoint = project.sequenceId
      ? `/api/video/sequence/${encodeURIComponent(project.sequenceId)}/cancel`
      : `/api/video/cancel/${encodeURIComponent(project.requestId)}`;

    try {
      const response = await originalFetch(endpoint, { method: 'POST', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo detener la generación.');
      if (loadingState) loadingState.classList.add('hidden');
      statusText.textContent = 'Cancelado';
      generateBtn.disabled = false;
      try {
        const projects = readProjects();
        const index = projects.findIndex(p => p.id === project.id);
        if (index >= 0) { projects[index] = { ...projects[index], status: 'cancelado', updatedAt: Date.now() }; localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); }
      } catch {}
    } catch (error) {
      setCancelled(null);
      cancelBtn.disabled = false;
      statusText.textContent = 'Error';
      if (errorBox) { errorBox.textContent = error.message || 'No se pudo detener la generación.'; errorBox.classList.remove('hidden'); }
    }
  }, true);
})();
