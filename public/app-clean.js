const $ = (selector) => document.querySelector(selector);
const form = $('#videoForm');
const promptInput = $('#prompt');
const audioTextInput = $('#audioText');
const audioLanguageInput = $('#audioLanguage');
const videoProviderInput = $('#videoProvider');
const providerHint = $('#providerHint');
const h3FirstFrameInput = $('#h3FirstFrame');
const h3LastFrameInput = $('#h3LastFrame');
const h3FramesPanel = $('#h3FramesPanel');
const projectNameInput = $('#projectName');
const negativeInput = $('#negative');
const aspectInput = $('#aspect');
const durationInput = $('#duration');
const resolutionInput = $('#resolution');
const frameRateInput = $('#frameRate');
const generateBtn = $('#generateBtn');
const cancelBtn = $('#cancelBtn');
const audioPreviewBtn = $('#audioPreviewBtn');
const copyPromptBtn = $('#copyPromptBtn');
const copyPromptStatus = $('#copyPromptStatus');
const charCount = $('#charCount');
const apiBadge = $('#apiBadge');
const statusText = $('#statusText');
const loadingState = $('#loadingState');
const loadingTitle = $('#loadingTitle');
const loadingDetail = $('#loadingDetail');
const emptyState = $('#emptyState');
const videoPlayer = $('#videoPlayer');
const videoLink = $('#videoLink');
const errorBox = $('#errorBox');
const historyEl = $('#history');
const projectsGrid = $('#projectsGrid');
const providerSetting = $('#providerSetting');
const providerDot = $('#providerDot');
const autosaveSetting = $('#autosaveSetting');
const languageSetting = $('#languageSetting');
const resetLocalBtn = $('#resetLocalBtn');
const clearHistory = $('#clearHistory');
const saveDraftBtn = $('#saveDraftBtn');

const STORAGE = { projects: 'salaProjects', history: 'salaHistory', settings: 'salaSettings' };
let pollTimer = null;
let activeJobId = null;
let activeProject = null;
const PROVIDERS = {
  seedance: { label: 'Seedance 2.0 Fast — Free quota', nativeAudio: true },
  wan: { label: 'Wan 2.7 — Free quota', nativeAudio: true },
  kling: { label: 'Kling VIDEO 3.0 — API', nativeAudio: true }
};
const TIMEOUT = 20 * 60 * 1000;

function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }
function escapeAttr(value) { return escapeHtml(value); }
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
function clearError() { errorBox.textContent = ''; errorBox.classList.add('hidden'); }
function setLoading(title, detail) { emptyState.classList.add('hidden'); loadingState.classList.remove('hidden'); loadingTitle.textContent = title; loadingDetail.textContent = detail; statusText.textContent = 'Procesando'; }
function updateCounter() { charCount.textContent = `${promptInput.value.length} / 4000`; }

async function copyPrompt() {
  const text = promptInput?.value.trim() || '';
  if (!text) {
    copyPromptStatus.textContent = 'Write a prompt first.';
    return;
  }
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const helper = document.createElement('textarea');
      helper.value = text; helper.setAttribute('readonly', '');
      helper.style.position = 'fixed'; helper.style.opacity = '0';
      document.body.appendChild(helper); helper.select();
      const copied = document.execCommand('copy');
      helper.remove();
      if (!copied) throw new Error('copy-failed');
    }
    copyPromptStatus.textContent = 'Prompt copied.';
    setTimeout(() => { copyPromptStatus.textContent = ''; }, 2200);
  } catch (_) {
    copyPromptStatus.textContent = 'Select the prompt and copy it manually.';
    promptInput.focus(); promptInput.select();
  }
}

function makeProjectId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch (_) {}
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentProject() {
  return {
    id: activeProject?.id || makeProjectId(),
    name: (projectNameInput.value.trim() || 'Proyecto sin título').slice(0, 80),
    prompt: promptInput.value.trim(),
    audioText: audioTextInput?.value.trim() || '',
    audioLanguage: audioLanguageInput?.value || 'en',
    negative: negativeInput.value.trim(),
    aspect: aspectInput.value,
    duration: Number(durationInput.value),
    resolution: resolutionInput.value,
    frameRate: frameRateInput ? Number(frameRateInput.value) : 24,
    videoProvider: selectedProvider(),
    createdAt: activeProject?.createdAt || Date.now(),
    updatedAt: Date.now(),
    status: 'borrador',
    url: ''
  };
}

function saveProject(extra = {}) {
  const project = { ...currentProject(), ...extra, updatedAt: Date.now() };
  const projects = read(STORAGE.projects, []);
  const index = projects.findIndex((item) => item.id === project.id);
  if (index >= 0) projects[index] = { ...projects[index], ...project }; else projects.unshift(project);
  write(STORAGE.projects, projects.slice(0, 30));
  activeProject = project;
  renderProjects();
  return project;
}

function saveHistory(item) {
  const items = read(STORAGE.history, []);
  items.unshift({ ...item, date: Date.now() });
  write(STORAGE.history, items.slice(0, 30));
  renderHistory();
}

function renderHistory() {
  const items = read(STORAGE.history, []);
  if (!items.length) { historyEl.className = 'history-empty'; historyEl.textContent = 'No activity yet.'; return; }
  historyEl.className = '';
  historyEl.innerHTML = items.map((item) => `<div class="history-item"><div><strong>${escapeHtml(item.name || 'Producción')}</strong><span>${new Date(item.date).toLocaleString()} · ${escapeHtml(item.status || '')}</span></div>${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : '<span>Guardado</span>'}</div>`).join('');
}

function renderProjects() {
  const items = read(STORAGE.projects, []);
  if (!items.length) { projectsGrid.innerHTML = '<div class="panel"><strong>Aún no tienes proyectos.</strong><p class="muted">Crea una producción para verla aquí.</p></div>'; return; }
  projectsGrid.innerHTML = items.map((p) => `<article class="project-card">${p.url ? `<video class="project-preview" src="${escapeAttr(p.url)}" muted playsinline preload="metadata"></video>` : '<div class="project-preview project-placeholder">🎬</div>'}<h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.prompt || 'Sin descripción')}</p><div class="project-meta"><span>${escapeHtml(p.aspect)} · ${escapeHtml(p.duration)}s</span><span>${new Date(p.updatedAt).toLocaleDateString()}</span></div><div class="project-actions"><button class="secondary open-project" data-id="${escapeAttr(p.id)}">Abrir proyecto</button>${p.url ? `<a class="secondary" href="${escapeAttr(p.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : ''}</div></article>`).join('');
}

function loadProject(id) {
  const p = read(STORAGE.projects, []).find((item) => item.id === id);
  if (!p) return;
  activeProject = p;
  projectNameInput.value = p.name || '';
  promptInput.value = p.prompt || '';
  if (audioTextInput) audioTextInput.value = p.audioText || '';
  if (audioLanguageInput) audioLanguageInput.value = p.audioLanguage || 'en';
  negativeInput.value = p.negative || '';
  aspectInput.value = p.aspect || '16:9';
  durationInput.value = String(p.duration || 5);
  resolutionInput.value = p.resolution || 'standard';
  if (frameRateInput) frameRateInput.value = String(p.frameRate || 24);
  if (videoProviderInput) videoProviderInput.value = p.videoProvider || 'h3';
  updateProviderUi();
  updateCounter();
  if (p.url) showVideo(p.url); else resetResult();
  showView('crear');
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const target = $(`#view-${name}`); if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

function resetResult() {
  clearError();
  loadingState.classList.add('hidden');
  videoPlayer.classList.add('hidden');
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
  videoLink.classList.add('hidden');
  emptyState.classList.remove('hidden');
  statusText.textContent = 'Sin producción activa';
}

function showVideo(url) {
  emptyState.classList.add('hidden');
  loadingState.classList.add('hidden');
  videoPlayer.src = url;
  videoPlayer.classList.remove('hidden');
  videoLink.href = url;
  videoLink.classList.remove('hidden');
  statusText.textContent = 'Completado';
}

async function health() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    const ready = response.ok && data.generationReady;
    apiBadge.textContent = ready ? 'H3 + Kling disponibles' : 'H3 disponible · Kling pendiente';
    providerSetting.textContent = `${data.provider || 'H3 + Kling'} · H3 ZeroGPU disponible${ready ? ' · Kling lista' : ''}`;
    providerDot.classList.toggle('ready', ready);
  } catch {
    apiBadge.textContent = 'Servidor desconectado';
    providerSetting.textContent = 'Servidor no disponible';
    providerDot.classList.remove('ready');
  }
}

async function poll(jobId, startedAt) {
  if (!activeJobId) return;
  if (Date.now() - startedAt > TIMEOUT) {
    await cancelActive();
    showError('La generación superó 20 minutos y fue cancelada. El crédito fue devuelto.');
    generateBtn.disabled = false; cancelBtn.disabled = true; return;
  }
  try {
    const response = await fetch(`/api/video/status/${encodeURIComponent(jobId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el estado.');
    setLoading(`Generando con ${data.provider || 'video engine'}…`, data.detail || `${data.providerState || 'Procesando'}`);
    if (data.status === 'COMPLETED' && data.outputUrl) {
      showVideo(data.outputUrl);
      saveProject({ status: 'completado', url: data.outputUrl, requestId: jobId });
      saveHistory({ name: activeProject?.name, prompt: activeProject?.prompt, status: 'completado', url: data.outputUrl });
      activeJobId = null; generateBtn.disabled = false; cancelBtn.disabled = true; return;
    }
    if (data.status === 'ERROR' || data.status === 'CANCELLED') throw new Error(data.detail || `La generación terminó con estado ${data.status}.`);
    pollTimer = setTimeout(() => poll(jobId, startedAt), 4000);
  } catch (error) {
    clearTimeout(pollTimer); activeJobId = null; generateBtn.disabled = false; cancelBtn.disabled = true;
    loadingState.classList.add('hidden'); statusText.textContent = 'Error'; showError(error.message);
  }
}

async function cancelActive() {
  if (h3Submission) { try { h3Submission.cancel(); } catch (_) {} h3Submission = null; }
  if (!activeJobId) return;
  clearTimeout(pollTimer);
  try { await fetch(`/api/video/cancel/${encodeURIComponent(activeJobId)}`, { method: 'POST' }); } catch (_) {}
  activeJobId = null; cancelBtn.disabled = true; generateBtn.disabled = false;
}

if (form) form.noValidate = true;

window.addEventListener('error', (event) => {
  if (event?.error) showError(`Error de la interfaz: ${event.error.message || event.error}`);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  if (reason) showError(`Error de la interfaz: ${reason.message || reason}`);
});

window.startSalaGeneration = startGeneration;
form?.addEventListener('submit', startGeneration);

async function startGeneration(event) {
  if (event) event.preventDefault();
  if (generateBtn?.disabled) return;
  clearError(); clearTimeout(pollTimer);
  const prompt = promptInput.value.trim();
  if (!prompt) return showError('Escribe una descripción de la escena.');
  if (activeJobId) return;
  const provider = selectedProvider();
  if (!PROVIDERS[provider]) return showError('Selecciona un motor de vídeo válido.');
  const project = saveProject({ status: 'procesando', url: '', videoProvider: provider });
  saveHistory({ name: project.name, prompt: project.prompt, status: 'solicitud enviada', provider });
  generateBtn.disabled = true; cancelBtn.disabled = false;
  setLoading(`Preparando ${PROVIDERS[provider].label}…`, 'Conectando con el motor de vídeo.');
  try {
    const response = await fetch('/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        videoProvider: provider,
        prompt,
        negative: negativeInput.value.trim(),
        aspect: aspectInput.value,
        duration: Number(durationInput.value),
        resolution: resolutionInput.value,
        audioText: audioTextInput?.value.trim() || '',
        audioLanguage: audioLanguageInput?.value || 'en'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `El servidor rechazó la generación (HTTP ${response.status}).`);
    activeJobId = data.request_id || data.requestId || data.job_id;
    if (!activeJobId) throw new Error('El motor no devolvió un identificador de trabajo.');
    saveProject({ status: 'procesando', requestId: activeJobId });
    poll(activeJobId, Date.now());
  } catch (error) {
    generateBtn.disabled = false; cancelBtn.disabled = true; loadingState.classList.add('hidden'); statusText.textContent = 'Error'; showError(error.message);
  }
}

generateBtn?.addEventListener('click', startGeneration);
form?.addEventListener('submit', startGeneration);

cancelBtn?.addEventListener('click', cancelActive);
copyPromptBtn?.addEventListener('click', copyPrompt);
audioPreviewBtn?.addEventListener('click', async () => {
  clearError();
  const text = audioTextInput?.value.trim();
  if (!text) return showError('Escribe primero el texto de narración.');
  audioPreviewBtn.disabled = true; audioPreviewBtn.textContent = 'Generando…';
  try {
    const response = await fetch('/api/audio/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language: audioLanguageInput?.value || 'en' }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo generar la voz.');
    const audio = new Audio(data.url); await audio.play();
  } catch (error) { showError(error.message); }
  finally { audioPreviewBtn.disabled = false; audioPreviewBtn.textContent = '▶ Listen'; }
});

saveDraftBtn?.addEventListener('click', () => { saveProject({ status: 'borrador' }); statusText.textContent = 'Borrador guardado'; });
clearHistory?.addEventListener('click', () => { localStorage.removeItem(STORAGE.history); renderHistory(); });
resetLocalBtn?.addEventListener('click', () => { localStorage.removeItem(STORAGE.projects); localStorage.removeItem(STORAGE.history); renderProjects(); renderHistory(); });
projectsGrid?.addEventListener('click', (event) => { const button = event.target.closest('.open-project'); if (button) loadProject(button.dataset.id); });
promptInput?.addEventListener('input', updateCounter);
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
videoProviderInput?.addEventListener('change', updateProviderUi);
updateProviderUi();
document.querySelectorAll('.use-template, .chip').forEach((button) => button.addEventListener('click', () => {
  const name = button.dataset.template;
  const templates = {
    cinematic: 'A cinematic, photorealistic scene of [SUBJECT] in [LOCATION], realistic movement, natural lighting, professional camera work and coherent physical motion.',
    social: 'A dynamic vertical social-media video of [SUBJECT] in [LOCATION], strong composition, realistic movement, energetic camera motion and a clean visual ending.',
    product: 'A premium cinematic product shot of [PRODUCT], slow camera movement, realistic studio lighting, reflections and shallow depth of field.',
    travel: 'A cinematic travel scene of [LANDSCAPE] at [TIME OF DAY], smooth camera movement, realistic atmosphere, natural light and a strong sense of scale.'
  };
  promptInput.value = templates[name] || ''; if (name === 'social') { aspectInput.value = '9:16'; durationInput.value = '10'; } updateCounter(); showView('crear'); promptInput.focus();
}));

autosaveSetting?.addEventListener('change', () => write(STORAGE.settings, { autosave: autosaveSetting.checked }));
languageSetting?.addEventListener('change', () => { write(STORAGE.settings, { ...read(STORAGE.settings, {}), language: languageSetting.value }); });

updateCounter(); renderProjects(); renderHistory(); health();
