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
let h3ClientPromise = null;
let h3Submission = null;
const H3_SPACE = 'MiniMaxAI/MiniMax-H3-Turbo-Lora';
const H3_CANVAS = { '16:9': '960x544 · 16:9 fast', '9:16': '544x960 · 9:16 fast', '1:1': '544x544 · 1:1 fast' };
const H3_LANGUAGE_NAMES = { en:'English', es:'Spanish', ru:'Russian', kk:'Kazakh', fr:'French', de:'German', it:'Italian', pt:'Portuguese', ar:'Arabic', ja:'Japanese', ko:'Korean', 'zh-CN':'Chinese' };

function selectedProvider() { return videoProviderInput?.value || 'h3'; }
function updateProviderUi() {
  const h3 = selectedProvider() === 'h3';
  const ltx = selectedProvider() === 'ltx';
  if (h3FramesPanel) h3FramesPanel.classList.toggle('hidden', !h3 && !ltx);
  if (providerHint) providerHint.textContent = h3
    ? 'MiniMax H3 runs directly from this page through the official Hugging Face Space. Free ZeroGPU has daily quotas and may queue when busy.'
    : ltx ? 'LTX Video 0.9.8 runs directly through the official Lightricks Hugging Face Space using free ZeroGPU.' : 'Kling VIDEO 3.0 uses the configured API on Render and requires an available Kling balance.';
  if (generateBtn) generateBtn.textContent = h3 ? 'Generate with MiniMax H3' : (ltx ? 'Generate with LTX Video' : 'Generate with Kling');
}

function buildH3Prompt(scene, dialogue, language) {
  const base = String(scene || '').trim();
  const text = String(dialogue || '').trim();
  if (!text) return base;
  const lang = H3_LANGUAGE_NAMES[language] || language || 'English';
  return [
    'integrated_multimodal_description:',
    '[Shot 1] ',
    base,
    'The visible speaking character is the source of the voice and remains clearly visible on camera. The character speaks physically with natural facial expressions, jaw and lip movements synchronized to every spoken word.',
    `The character says exactly this dialogue: <d>[${lang}] ${text}</d>`,
    'The mouth must not remain closed while the dialogue is heard. No off-screen narrator. After speaking, the character stops speaking and returns to natural facial motion.',
    '',
    'overall_soundscape: Natural environmental and action sounds matching the scene; dialogue remains clear and synchronized.',
    'non_diegetic_music: N/A unless the scene description explicitly requests music.'
  ].join('\n');
}

async function getH3Client() {
  if (!h3ClientPromise) {
    h3ClientPromise = import('https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/dist/index.min.js')
      .then(({ Client }) => {
        const token = localStorage.getItem('sala_hf_token') || '';
        const options = { events: ['data', 'status'] };
        if (token) options.token = token;
        return Client.connect(H3_SPACE, options);
      });
  }
  return h3ClientPromise;
}

function h3VideoUrl(video) {
  if (!video) return '';
  if (typeof video === 'string') return video.startsWith('http') ? video : `https://huggingface.co/spaces/${H3_SPACE}/gradio_api/file=${video}`;
  if (video.url) return video.url.startsWith('http') ? video.url : `https://huggingface.co/spaces/${H3_SPACE}/gradio_api/file=${String(video.url).replace(/^\//, '')}`;
  if (video.path) return `https://huggingface.co/spaces/${H3_SPACE}/gradio_api/file=${video.path}`;
  return '';
}

async function generateWithH3({ prompt, audioText, audioLanguage, aspect, duration }) {
  const client = await getH3Client();
  const firstFile = h3FirstFrameInput?.files?.[0] || null;
  const lastFile = h3LastFrameInput?.files?.[0] || null;
  const { handle_file } = await import('https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/dist/index.min.js');
  const first = firstFile ? handle_file(firstFile) : null;
  const last = lastFile ? handle_file(lastFile) : null;
  const canvas = H3_CANVAS[aspect] || H3_CANVAS['16:9'];
  const safeDuration = Math.max(2, Math.min(14, Number(duration) || 5));
  const seed = Math.floor(Math.random() * 2147483647);
  // Render is a custom frontend, so the HF iframe ZeroGPU identity header is unavailable. Keep anonymous H3 requests within the 120-second xlarge reservation ceiling.
  const steps = 4;
  const promptText = buildH3Prompt(prompt, audioText, audioLanguage);
  setLoading('MiniMax H3 en cola…', 'Esperando GPU gratuita de ZeroGPU…');
  const result = await client.predict('/output_video', [
    promptText, first, last, canvas, safeDuration, steps, seed, false, 'larry'
  ]);
  let data = result?.data || result || [];
  if (data.length === 1 && Array.isArray(data[0])) data = data[0];
  const [video, report, refined] = data;
  const url = h3VideoUrl(video);
  if (!url) throw new Error('MiniMax H3 terminó pero no devolvió una referencia de vídeo.');
  return { url, report: report || 'MiniMax H3 · vídeo + audio sincronizados', refined: refined || '' };
}
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
    setLoading('Generando con Kling VIDEO 3.0…', data.detail || `${data.providerState || 'Procesando'} · escena ${data.currentScene || 0}/${data.totalScenes || 1}`);
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
  if (selectedProvider() === 'ltx') {
    const dialogue = audioTextInput?.value.trim() || '';
    if (dialogue) {
      // LTX is a video-only engine. Never spend LTX ZeroGPU quota on a request
      // that asks for synchronized dialogue; H3 is the native audiovisual path.
      if (window.startH3Generation) return window.startH3Generation(event);
      return showError('Para generar diálogo sincronizado, MiniMax H3 debe estar disponible. LTX no genera audio nativo.');
    }
    if (window.startLtxGeneration) return window.startLtxGeneration(event);
    return showError('El generador LTX no está cargado.');
  }
  if (selectedProvider() === 'h3' && window.startH3Generation && !generateBtn?.disabled) {
    return window.startH3Generation(event);
  }
  if (generateBtn?.disabled) return;
  clearError(); clearTimeout(pollTimer);
  const prompt = promptInput.value.trim();
  if (!prompt) return showError('Escribe una descripción de la escena.');
  if (activeJobId) return;
  const project = saveProject({ status: 'procesando', url: '', videoProvider: selectedProvider() });
  saveHistory({ name: project.name, prompt: project.prompt, status: 'solicitud enviada', provider: selectedProvider() });
  generateBtn.disabled = true; cancelBtn.disabled = false;
  setLoading(selectedProvider() === 'h3' ? 'Preparando MiniMax H3…' : 'Preparando Kling VIDEO 3.0…', selectedProvider() === 'h3' ? 'Conectando directamente con Hugging Face ZeroGPU.' : 'Conectando con Kling VIDEO 3.0 Native Audio.');
  try {
    if (selectedProvider() === 'h3') {
      const result = await generateWithH3({ prompt, audioText: audioTextInput?.value.trim() || '', audioLanguage: audioLanguageInput?.value || 'en', aspect: aspectInput.value, duration: Number(durationInput.value) });
      showVideo(result.url);
      saveProject({ status: 'completado', url: result.url, providerReport: result.report, refinedPrompt: result.refined });
      saveHistory({ name: activeProject?.name, prompt: activeProject?.prompt, status: 'completado', url: result.url, provider: 'MiniMax H3' });
      activeJobId = null; generateBtn.disabled = false; cancelBtn.disabled = true; return;
    }
    const response = await fetch('/api/video/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, negative: negativeInput.value.trim(), aspect: aspectInput.value, duration: Number(durationInput.value), resolution: resolutionInput.value, audioText: audioTextInput?.value.trim() || '', audioLanguage: audioLanguageInput?.value || 'en' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `El servidor rechazó la generación (HTTP ${response.status}).`);
    activeJobId = data.request_id || data.requestId || data.job_id;
    if (!activeJobId) throw new Error('El motor no devolvió un identificador de trabajo.');
    saveProject({ status: 'procesando', requestId: activeJobId, sequenceId: data.job_id || '' });
    poll(activeJobId, Date.now());
  } catch (error) {
    h3Submission = null;
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
