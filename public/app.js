const $ = (selector) => document.querySelector(selector);
const form = $('#videoForm');
const projectNameInput = $('#projectName');
const promptInput = $('#prompt');
const negativeInput = $('#negative');
const aspectInput = $('#aspect');
const resolutionInput = $('#resolution');
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

const STORAGE = {
  projects: 'salaProjects',
  history: 'salaHistory',
  settings: 'salaSettings',
};

const templates = {
  cinematic: 'Una escena cinematográfica de [SUJETO] en [LUGAR], movimiento de cámara suave y realista, iluminación dramática, profundidad de campo, composición profesional, ambiente natural y acabado de película.',
  social: 'Vídeo vertical dinámico de [SUJETO] en [LUGAR], composición pensada para redes sociales, movimiento de cámara atractivo, iluminación vibrante, ritmo visual rápido y final impactante.',
  product: 'Presentación cinematográfica de [PRODUCTO] sobre un escenario limpio y elegante, cámara realizando un movimiento lento alrededor del producto, iluminación de estudio, reflejos realistas y acabado premium.',
  travel: 'Plano cinematográfico de [PAISAJE] durante [MOMENTO DEL DÍA], cámara avanzando suavemente, escala impresionante, luz natural, atmósfera realista y sensación de descubrimiento.'
};

let pollTimer;
let currentRequestId = null;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}

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
  if (!items.length) {
    history.className = 'history-empty';
    history.textContent = 'Todavía no hay actividad.';
    return;
  }
  history.className = '';
  history.innerHTML = items.map((item) => `
    <div class="history-item">
      <div><strong>${escapeHtml(item.name || item.prompt || 'Producción')}</strong><span>${new Date(item.date).toLocaleString()} · ${escapeHtml(item.aspect || '16:9')} · ${escapeHtml(item.status || 'Guardado')}</span></div>
      ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : '<span>Preparado</span>'}
    </div>
  `).join('');
}

function saveProject(overrides = {}) {
  const prompt = promptInput.value.trim();
  const name = (projectNameInput.value.trim() || 'Proyecto sin título').slice(0, 80);
  const projects = readJson(STORAGE.projects, []);
  const project = {
    id: overrides.id || crypto.randomUUID(),
    name,
    prompt,
    negative: negativeInput.value.trim(),
    aspect: aspectInput.value,
    resolution: resolutionInput.value,
    updatedAt: Date.now(),
    createdAt: overrides.createdAt || Date.now(),
    status: overrides.status || 'borrador',
    url: overrides.url || '',
  };
  const index = projects.findIndex((item) => item.id === project.id);
  if (index >= 0) projects[index] = { ...projects[index], ...project };
  else projects.unshift(project);
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
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.prompt || 'Sin descripción')}</p>
      <div class="project-meta"><span>${escapeHtml(project.aspect)}</span><span>${new Date(project.updatedAt).toLocaleDateString()}</span></div>
      <button class="secondary open-project" data-id="${escapeAttr(project.id)}">Abrir proyecto</button>
      ${project.url ? `<a class="secondary" href="${escapeAttr(project.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : ''}
    </article>
  `).join('');
}

function openProject(id) {
  const project = readJson(STORAGE.projects, []).find((item) => item.id === id);
  if (!project) return;
  projectNameInput.value = project.name || '';
  promptInput.value = project.prompt || '';
  negativeInput.value = project.negative || '';
  aspectInput.value = project.aspect || '16:9';
  resolutionInput.value = project.resolution || '768';
  updateCounter();
  showView('crear');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  const target = $(`#view-${name}`);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
}

function applyTemplate(name) {
  if (!templates[name]) return;
  promptInput.value = templates[name];
  if (name === 'social') aspectInput.value = '9:16';
  updateCounter();
  showView('crear');
  promptInput.focus();
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    const ready = Boolean(data.generationReady || data.pixazoConfigured);
    apiBadge.textContent = ready ? 'API lista' : 'API pendiente';
    apiBadge.title = ready ? 'El proveedor está configurado.' : 'La interfaz está lista; falta la API key para generar.';
    providerSetting.textContent = `${data.provider || 'Proveedor de vídeo'} · ${ready ? 'lista' : 'esperando API key'}`;
    providerDot.classList.toggle('ready', ready);
  } catch {
    apiBadge.textContent = 'Servidor desconectado';
    providerSetting.textContent = 'Servidor no disponible';
    providerDot.classList.remove('ready');
  }
}

async function pollStatus(requestId, project) {
  currentRequestId = requestId;
  clearTimeout(pollTimer);
  try {
    const response = await fetch(`/api/video/status/${encodeURIComponent(requestId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el estado.');
    const state = String(data.status || data.state || '').toUpperCase();
    if (state === 'COMPLETED' || state === 'SUCCEEDED' || data.output?.media_url) {
      const rawUrl = data.output?.media_url;
      const url = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl;
      if (!url) throw new Error('La generación terminó, pero no devolvió un vídeo.');
      videoPlayer.src = url;
      videoPlayer.classList.remove('hidden');
      videoLink.href = url;
      videoLink.classList.remove('hidden');
      loadingState.classList.add('hidden');
      statusText.textContent = 'Completado';
      saveHistory({ name: project.name, prompt: project.prompt, aspect: project.aspect, url, date: Date.now(), status: 'completado' });
      saveProject({ ...project, status: 'completado', url });
      currentRequestId = null;
      generateBtn.disabled = false;
      return;
    }
    if (['ERROR','FAILED','CANCELLED'].includes(state)) throw new Error(data.error || `La generación terminó con estado ${state}.`);
    setLoading('Generando vídeo…', `Estado: ${state || 'EN COLA'}. Comprobando de nuevo en 5 segundos.`);
    pollTimer = setTimeout(() => pollStatus(requestId, project), 5000);
  } catch (error) {
    loadingState.classList.add('hidden');
    statusText.textContent = 'Error';
    showError(error.message);
    generateBtn.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearTimeout(pollTimer);
  clearResult();
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  const project = saveProject({ status: 'pendiente' });
  saveHistory({ name: project.name, prompt, aspect: project.aspect, date: Date.now(), status: 'solicitud enviada' });
  generateBtn.disabled = true;
  setLoading('Enviando solicitud…', 'Contactando con el motor de generación.');
  try {
    const response = await fetch('/api/video/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative: negativeInput.value.trim(),
        aspect: aspectInput.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la generación.');
    const requestId = data.request_id || data.requestId;
    if (!requestId) throw new Error('El proveedor no devolvió un identificador de generación.');
    await pollStatus(requestId, project);
  } catch (error) {
    loadingState.classList.add('hidden');
    statusText.textContent = 'Error';
    showError(error.message);
    generateBtn.disabled = false;
  }
});

saveDraftBtn.addEventListener('click', () => {
  const project = saveProject({ status: 'borrador' });
  saveHistory({ name: project.name, prompt: project.prompt, aspect: project.aspect, date: Date.now(), status: 'borrador guardado' });
  saveDraftBtn.textContent = '✓ Proyecto guardado';
  setTimeout(() => { saveDraftBtn.textContent = 'Guardar proyecto'; }, 1600);
});

promptInput.addEventListener('input', () => { updateCounter(); if (autosaveSetting.checked) saveProject({ status: 'borrador' }); });

clearHistory.addEventListener('click', () => { localStorage.removeItem(STORAGE.history); renderHistory(); });

document.querySelectorAll('.nav-btn').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-template]').forEach((button) => button.addEventListener('click', () => applyTemplate(button.dataset.template)));

projectsGrid.addEventListener('click', (event) => {
  const button = event.target.closest('.open-project');
  if (button) openProject(button.dataset.id);
});

$('#newProjectBtn').addEventListener('click', () => { form.reset(); updateCounter(); clearResult(); showView('crear'); promptInput.focus(); });

languageSetting.addEventListener('change', () => {
  const settings = readJson(STORAGE.settings, {}); settings.language = languageSetting.value; writeJson(STORAGE.settings, settings);
});
autosaveSetting.addEventListener('change', () => {
  const settings = readJson(STORAGE.settings, {}); settings.autosave = autosaveSetting.checked; writeJson(STORAGE.settings, settings);
});

resetLocalBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar proyectos, historial y preferencias locales?')) return;
  Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
  renderProjects(); renderHistory();
  autosaveSetting.checked = true; languageSetting.value = 'es';
});

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function escapeAttr(value) { return escapeHtml(value); }

const settings = readJson(STORAGE.settings, { language: 'es', autosave: true });
languageSetting.value = settings.language || 'es';
autosaveSetting.checked = settings.autosave !== false;
updateCounter();
renderProjects();
renderHistory();
checkHealth();
