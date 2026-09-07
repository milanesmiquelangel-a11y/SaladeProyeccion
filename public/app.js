const form = document.querySelector('#videoForm');
const promptInput = document.querySelector('#prompt');
const negativeInput = document.querySelector('#negative');
const aspectInput = document.querySelector('#aspect');
const resolutionInput = document.querySelector('#resolution');
const generateBtn = document.querySelector('#generateBtn');
const charCount = document.querySelector('#charCount');
const apiBadge = document.querySelector('#apiBadge');
const statusText = document.querySelector('#statusText');
const emptyState = document.querySelector('#emptyState');
const loadingState = document.querySelector('#loadingState');
const loadingTitle = document.querySelector('#loadingTitle');
const loadingDetail = document.querySelector('#loadingDetail');
const videoPlayer = document.querySelector('#videoPlayer');
const videoLink = document.querySelector('#videoLink');
const errorBox = document.querySelector('#errorBox');
const history = document.querySelector('#history');
const clearHistory = document.querySelector('#clearHistory');

let pollTimer;

function updateCounter() {
  charCount.textContent = `${promptInput.value.length} / 4000`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearResult() {
  errorBox.classList.add('hidden');
  videoPlayer.classList.add('hidden');
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
  videoLink.classList.add('hidden');
  emptyState.classList.remove('hidden');
  loadingState.classList.add('hidden');
}

function setLoading(title, detail) {
  emptyState.classList.add('hidden');
  loadingState.classList.remove('hidden');
  loadingTitle.textContent = title;
  loadingDetail.textContent = detail;
  statusText.textContent = 'Procesando';
}

function saveHistory(item) {
  const current = JSON.parse(localStorage.getItem('salaHistory') || '[]');
  current.unshift(item);
  localStorage.setItem('salaHistory', JSON.stringify(current.slice(0, 10)));
  renderHistory();
}

function renderHistory() {
  const items = JSON.parse(localStorage.getItem('salaHistory') || '[]');
  if (!items.length) {
    history.className = 'history-empty';
    history.textContent = 'Todavía no hay producciones guardadas en este navegador.';
    return;
  }
  history.className = '';
  history.innerHTML = items.map((item) => `
    <div class="history-item">
      <div><strong>${escapeHtml(item.prompt)}</strong><span>${new Date(item.date).toLocaleString()} · ${escapeHtml(item.aspect)}</span></div>
      ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Ver vídeo</a>` : '<span>Sin vídeo</span>'}
    </div>
  `).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    apiBadge.textContent = data.pixazoConfigured ? 'API lista' : 'API sin clave';
    apiBadge.title = data.pixazoConfigured ? 'Pixazo está configurado en el servidor.' : 'Falta PIXAZO_API_KEY en el servidor.';
  } catch {
    apiBadge.textContent = 'Servidor desconectado';
  }
}

async function pollStatus(requestId, prompt) {
  clearTimeout(pollTimer);
  try {
    const response = await fetch(`/api/video/status/${encodeURIComponent(requestId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el estado.');

    const state = String(data.status || '').toUpperCase();
    if (state === 'COMPLETED') {
      const url = Array.isArray(data.output?.media_url) ? data.output.media_url[0] : data.output?.media_url;
      if (!url) throw new Error('La generación terminó, pero Pixazo no devolvió el vídeo.');
      videoPlayer.src = url;
      videoPlayer.classList.remove('hidden');
      videoLink.href = url;
      videoLink.classList.remove('hidden');
      loadingState.classList.add('hidden');
      statusText.textContent = 'Completado';
      saveHistory({ prompt, aspect: aspectInput.value, url, date: Date.now() });
      return;
    }

    if (['ERROR', 'FAILED', 'CANCELLED'].includes(state)) {
      throw new Error(data.error || `La generación terminó con estado ${state}.`);
    }

    setLoading('Generando vídeo…', `Estado: ${state || 'EN COLA'}. Comprobando de nuevo en 5 segundos.`);
    pollTimer = setTimeout(() => pollStatus(requestId, prompt), 5000);
  } catch (error) {
    loadingState.classList.add('hidden');
    statusText.textContent = 'Error';
    showError(error.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearTimeout(pollTimer);
  clearResult();

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  generateBtn.disabled = true;
  setLoading('Enviando solicitud…', 'Contactando con el motor de generación.');

  try {
    const size = Number(resolutionInput.value);
    const response = await fetch('/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative: negativeInput.value.trim(),
        aspect: aspectInput.value,
        width: size,
        height: size,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'No se pudo iniciar la generación.');
    }

    const requestId = data.request_id;
    if (!requestId) throw new Error('Pixazo no devolvió un request_id.');
    saveHistory({ prompt, aspect: aspectInput.value, date: Date.now(), url: '' });
    await pollStatus(requestId, prompt);
  } catch (error) {
    loadingState.classList.add('hidden');
    statusText.textContent = 'Error';
    showError(error.message);
  } finally {
    generateBtn.disabled = false;
  }
});

promptInput.addEventListener('input', updateCounter);
clearHistory.addEventListener('click', () => {
  localStorage.removeItem('salaHistory');
  renderHistory();
});

updateCounter();
renderHistory();
checkHealth();
