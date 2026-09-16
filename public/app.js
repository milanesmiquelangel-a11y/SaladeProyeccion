const $ = (selector) => document.querySelector(selector);
const form = $('#videoForm');
const projectNameInput = $('#projectName');
const promptInput = $('#prompt');
const negativeInput = $('#negative');
const aspectInput = $('#aspect');
const durationInput = $('#duration');
const resolutionInput = $('#resolution');
const frameRateInput = $('#frameRate');
const generateBtn = $('#generateBtn');
const saveDraftBtn = $('#saveDraftBtn');
const charCount = $('#charCount');
const apiBadge = $('#apiBadge');
const statusText = $('#statusText');
const emptyState = $('#emptyState');
const loadingState = $('#loadingState');
const loadingTitle = $('#loadingTitle');
const loadingDetail = $('#loadingDetail');
const videoPlayer = $('#videoPlayer');
const videoLink = $('#videoLink');
const errorBox = $('#errorBox');
const history = $('#history');
const clearHistory = $('#clearHistory');
const projectsGrid = $('#projectsGrid');
const providerSetting = $('#providerSetting');
const providerDot = $('#providerDot');
const autosaveSetting = $('#autosaveSetting');
const languageSetting = $('#languageSetting');
const resetLocalBtn = $('#resetLocalBtn');

const STORAGE = { projects: 'salaProjects', history: 'salaHistory', settings: 'salaSettings' };
const templates = {
  cinematic: 'Una escena cinematográfica de [SUJETO] en [LUGAR], movimiento de cámara suave y realista, iluminación dramática, profundidad de campo, composición profesional, ambiente natural y acabado de película.',
  social: 'Vídeo vertical dinámico de [SUJETO] en [LUGAR], composición pensada para redes sociales, movimiento de cámara atractivo, iluminación vibrante, ritmo visual rápido y final impactante.',
  taxidrive: `Create a photorealistic 30-second vertical promotional Reel for TaxiDrive.kz in Kazakhstan. Use the same modern black Haval M6 taxi throughout the entire story. The commercial tells a simple transportation journey: first show the taxi traveling through the Kazakh steppe, then show a passenger safely using a smartphone while the car is stopped, then show the taxi arriving for pickup, then show a correctly composed interior with ONE driver alone in the driver's seat behind the steering wheel and ONE passenger alone in the opposite front passenger seat, with clearly separated bodies and seats, and finish with a premium exterior hero shot of the same black Haval M6. Keep people anatomically correct and consistent. Never put two people in one seat. Never put the passenger behind the steering wheel. Never merge or overlap bodies. Never show the passenger using a phone while the vehicle is moving. Use cinematic golden-hour lighting, realistic Kazakhstan landscapes, smooth professional commercial camera movement, premium automotive advertising cinematography, natural motion, realistic reflections and strong visual continuity between scenes. Do not attempt complex readable smartphone text; show only a clean generic taxi-app interface.`,
  product: 'Presentación cinematográfica de [PRODUCTO] sobre un escenario limpio y elegante, cámara realizando un movimiento lento alrededor del producto, iluminación de estudio, reflejos realistas y acabado premium.',
  travel: 'Plano cinematográfico de [PAISAJE] durante [MOMENTO DEL DÍA], cámara avanzando suavemente, escala impresionante, luz natural, atmósfera realista y sensación de descubrimiento.'
};

let pollTimer;
let currentRequestId = null;
let currentSequenceId = null;
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function updateCounter() { charCount.textContent = `${promptInput.value.length} / 4000`; }
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
function clearError() { errorBox.classList.add('hidden'); errorBox.textContent = ''; }

function clearResult() {
  clearError();
  videoPlayer.classList.add('hidden');
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
  videoLink.classList.add('hidden');
  videoLink.removeAttribute('href');
  emptyState.classList.remove('hidden');
  loadingState.classList.add('hidden');
  statusText.textContent = 'Sin producción activa';
}

function setLoading(title, detail) {
  emptyState.classList.add('hidden');
  loadingState.classList.remove('hidden');
  loadingTitle.textContent = title;
  loadingDetail.textContent = detail;
  statusText.textContent = 'Procesando';
}

function saveHistory(item) {
  const items = readJson(STORAGE.history, []);
  items.unshift(item);
  writeJson(STORAGE.history, items.slice(0, 20));
  renderHistory();
}

function renderHistory() {
  const items = readJson(STORAGE.history, []);
  if (!items.length) { history.className = 'history-empty'; history.textContent = 'Todavía no hay actividad.'; return; }
  history.className = '';
  history.innerHTML = items.map((item) => `
    <div class="history-item">
      <div><strong>${escapeHtml(item.name || item.prompt || 'Producción')}</strong><span>${new Date(item.date).toLocaleString()} · ${escapeHtml(item.aspect || '16:9')} · ${escapeHtml(item.duration ? `${item.duration}s` : '')} · ${escapeHtml(item.status || 'Guardado')}</span></div>
      ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : '<span>Preparado</span>'}
    </div>`).join('');
}

function saveProject(overrides = {}) {
  const prompt = promptInput.value.trim();
  const name = (projectNameInput.value.trim() || 'Proyecto sin título').slice(0, 80);
  const projects = readJson(STORAGE.projects, []);
  const project = {
    id: overrides.id || crypto.randomUUID(), name, prompt,
    negative: negativeInput.value.trim(), aspect: aspectInput.value,
    duration: Number(durationInput.value), resolution: resolutionInput.value,
    frameRate: Number(frameRateInput.value), updatedAt: Date.now(),
    createdAt: overrides.createdAt || Date.now(), status: overrides.status || 'borrador',
    url: overrides.url || '', requestId: overrides.requestId || '', sequenceId: overrides.sequenceId || ''
  };
  const index = projects.findIndex((item) => item.id === project.id);
  if (index >= 0) projects[index] = { ...projects[index], ...project }; else projects.unshift(project);
  writeJson(STORAGE.projects, projects.slice(0, 30));
  renderProjects();
  return project;
}

function renderProjects() {
  const projects = readJson(STORAGE.projects, []);
  if (!projects.length) {
    projectsGrid.innerHTML = '<div class="panel"><strong>Aún no tienes proyectos.</strong><p class="muted">Crea un proyecto desde la pestaña Crear y aparecerá aquí.</p></div>';
    return;
  }
  projectsGrid.innerHTML = projects.map((project) => `
    <article class="project-card">
      ${project.url ? `<video class="project-preview" src="${escapeAttr(project.url)}" muted playsinline preload="metadata"></video>` : '<div class="project-preview project-placeholder">🎬</div>'}
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.prompt || 'Sin descripción')}</p>
      <div class="project-meta"><span>${escapeHtml(project.aspect)} · ${escapeHtml(project.duration ? `${project.duration}s` : '')}</span><span>${new Date(project.updatedAt).toLocaleDateString()}</span></div>
      <div class="project-actions">
        <button class="secondary open-project" data-id="${escapeAttr(project.id)}">Abrir proyecto</button>
        ${project.url ? `<a class="secondary" href="${escapeAttr(project.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : ''}
      </div>
    </article>`).join('');
}

function openProject(id) {
  const project = readJson(STORAGE.projects, []).find((item) => item.id === id);
  if (!project) return;
  projectNameInput.value = project.name || '';
  promptInput.value = project.prompt || '';
  negativeInput.value = project.negative || '';
  aspectInput.value = project.aspect || '16:9';
  durationInput.value = String(project.duration || 5);
  resolutionInput.value = project.resolution || 'standard';
  frameRateInput.value = String(project.frameRate || 24);
  updateCounter();
  if (project.url) {
    videoPlayer.src = project.url; videoPlayer.classList.remove('hidden');
    videoLink.href = project.url; videoLink.classList.remove('hidden');
    emptyState.classList.add('hidden'); statusText.textContent = 'Completado';
  } else clearResult();
  showView('crear'); window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  const target = $(`#view-${name}`); if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
}

function applyTemplate(name) {
  if (!templates[name]) return;
  promptInput.value = templates[name];
  if (name === 'social' || name === 'taxidrive') { aspectInput.value = '9:16'; durationInput.value = '30'; }
  updateCounter(); showView('crear'); promptInput.focus();
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health'); const data = await response.json();
    const ready = Boolean(data.generationReady);
    apiBadge.textContent = ready ? 'API lista' : 'API pendiente';
    apiBadge.title = ready ? 'El proveedor está configurado.' : 'El servidor de generación no está listo.';
    providerSetting.textContent = `${data.provider || 'Proveedor de vídeo'} · ${ready ? 'lista' : 'esperando'}`;
    providerDot.classList.toggle('ready', ready);
  } catch {
    apiBadge.textContent = 'Servidor desconectado'; providerSetting.textContent = 'Servidor no disponible'; providerDot.classList.remove('ready');
  }
}

function finishVideo(url, project, extra = {}) {
  videoPlayer.src = url; videoPlayer.classList.remove('hidden');
  videoLink.href = url; videoLink.classList.remove('hidden');
  loadingState.classList.add('hidden'); statusText.textContent = 'Completado';
  saveHistory({ name: project.name, prompt: project.prompt, aspect: project.aspect, duration: project.duration, url, date: Date.now(), status: 'completado' });
  saveProject({ ...project, ...extra, status: 'completado', url });
  currentRequestId = null; currentSequenceId = null; generateBtn.disabled = false;
}

async function cancelTimedOutGeneration(requestId) {
  try {
    const response = await fetch(`/api/video/cancel/${encodeURIComponent(requestId)}`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, data: { error: error.message || 'No se pudo contactar con el servidor.' } };
  }
}

async function pollStatus(requestId, project, startedAt = Date.now()) {
  currentRequestId = requestId; clearTimeout(pollTimer);
  try {
    if (Date.now() - startedAt >= GENERATION_TIMEOUT_MS) {
      const result = await cancelTimedOutGeneration(requestId);
      loadingState.classList.add('hidden'); statusText.textContent = 'Tiempo agotado';
      showError(result.data?.creditRefunded ? 'La generación superó 20 minutos. Fue cancelada y el crédito fue devuelto.' : 'La generación superó 20 minutos. Fue cancelada; el servidor actualizará el saldo automáticamente.');
      generateBtn.disabled = false;
      return;
    }
    const response = await fetch(`/api/video/status/${encodeURIComponent(requestId)}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el estado.');
    const state = String(data.status || data.state || '').toUpperCase();
    if (state === 'COMPLETED' || state === 'SUCCEEDED' || data.output?.media_url) {
      const rawUrl = data.output?.media_url; const url = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
      if (!url) throw new Error('La generación terminó, pero no devolvió un vídeo.');
      finishVideo(url, project, { requestId }); return;
    }
    if (['ERROR','FAILED','CANCELLED'].includes(state)) throw new Error(data.error || `La generación terminó con estado ${state}.`);
    setLoading('Generando clip…', `Estado: ${state || 'EN COLA'}. Comprobando de nuevo en 5 segundos.`);
    pollTimer = setTimeout(() => pollStatus(requestId, project, startedAt), 5000);
  } catch (error) {
    loadingState.classList.add('hidden'); statusText.textContent = 'Error'; showError(error.message); generateBtn.disabled = false;
  }
}

async function pollSequence(jobId, project) {
  currentSequenceId = jobId; clearTimeout(pollTimer);
  try {
    const response = await fetch(`/api/video/sequence/${encodeURIComponent(jobId)}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar la producción.');
    const sceneText = data.totalScenes ? `Escena ${data.currentScene || 0} de ${data.totalScenes}` : 'Preparando escenas';
    setLoading('Creando vídeo promocional…', `${sceneText}. ${data.detail || 'Procesando…'}`);
    if (data.status === 'COMPLETED' && data.outputUrl) { finishVideo(data.outputUrl, project, { sequenceId: jobId }); return; }
    if (data.status === 'ERROR') throw new Error(data.detail || 'La producción no pudo completarse.');
    pollTimer = setTimeout(() => pollSequence(jobId, project), 5000);
  } catch (error) {
    loadingState.classList.add('hidden'); statusText.textContent = 'Error'; showError(error.message); generateBtn.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault(); clearTimeout(pollTimer); clearResult();
  const prompt = promptInput.value.trim(); if (!prompt) return;
  const totalDuration = Number(durationInput.value);
  const project = saveProject({ status: 'pendiente' });
  saveHistory({ name: project.name, prompt, aspect: project.aspect, duration: project.duration, date: Date.now(), status: 'solicitud enviada' });
  generateBtn.disabled = true;
  try {
    if (totalDuration > 5) {
      setLoading('Preparando vídeo promocional…', `Se crearán ${Math.ceil(totalDuration / 5)} escenas de 5 segundos y se unirán automáticamente.`);
      const response = await fetch('/api/video/sequence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, negative: negativeInput.value.trim(), aspect: aspectInput.value, duration: totalDuration, resolution: resolutionInput.value, frameRate: Number(frameRateInput.value) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar el vídeo promocional.');
      saveProject({ ...project, sequenceId: data.job_id, status: 'procesando' });
      await pollSequence(data.job_id, project);
      return;
    }

    setLoading('Enviando solicitud…', 'Contactando con WAN 2.2 ZeroGPU.');
    const response = await fetch('/api/video/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, negative: negativeInput.value.trim(), aspect: aspectInput.value, duration: totalDuration, resolution: resolutionInput.value, frameRate: Number(frameRateInput.value) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la generación.');
    const requestId = data.request_id || data.requestId;
    if (!requestId) throw new Error('El proveedor no devolvió un identificador de generación.');
    saveProject({ ...project, requestId, status: 'procesando' });
    await pollStatus(requestId, project);
  } catch (error) {
    loadingState.classList.add('hidden'); statusText.textContent = 'Error'; showError(error.message); generateBtn.disabled = false;
  }
});

saveDraftBtn.addEventListener('click', () => {
  const project = saveProject({ status: 'borrador' });
  saveHistory({ name: project.name, prompt: project.prompt, aspect: project.aspect, duration: project.duration, date: Date.now(), status: 'borrador guardado' });
});

clearHistory.addEventListener('click', () => { localStorage.removeItem(STORAGE.history); renderHistory(); });
projectsGrid.addEventListener('click', (event) => { const button = event.target.closest('.open-project'); if (button) openProject(button.dataset.id); });
document.querySelectorAll('[data-template]').forEach((button) => button.addEventListener('click', () => applyTemplate(button.dataset.template)));
document.querySelectorAll('.nav-btn').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
promptInput.addEventListener('input', updateCounter);
resetLocalBtn.addEventListener('click', () => { Object.values(STORAGE).forEach((key) => localStorage.removeItem(key)); location.reload(); });

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
function escapeAttr(value) { return escapeHtml(value); }

updateCounter(); renderHistory(); renderProjects(); showView('crear'); checkHealth();
