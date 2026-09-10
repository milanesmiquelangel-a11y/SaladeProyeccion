(() => {
  const form = document.querySelector('#videoForm');
  const imageInput = document.querySelector('#imageInput');
  const imagePreview = document.querySelector('#imagePreview');
  const durationInput = document.querySelector('#duration');
  const resolutionInput = document.querySelector('#resolution');
  const generateBtn = document.querySelector('#generateBtn');
  const cancelBtn = document.querySelector('#cancelBtn');
  const promptInput = document.querySelector('#prompt');
  const projectNameInput = document.querySelector('#projectName');
  const audioTextInput = document.querySelector('#audioText');
  const audioLanguageInput = document.querySelector('#audioLanguage');
  const audioPreviewBtn = document.querySelector('#audioPreviewBtn');
  const loadingState = document.querySelector('#loadingState');
  const loadingTitle = document.querySelector('#loadingTitle');
  const loadingDetail = document.querySelector('#loadingDetail');
  const emptyState = document.querySelector('#emptyState');
  const videoPlayer = document.querySelector('#videoPlayer');
  const videoLink = document.querySelector('#videoLink');
  const errorBox = document.querySelector('#errorBox');
  const statusText = document.querySelector('#statusText');
  if (!form || !imageInput) return;

  let selectedFile = null;
  let imageJobId = null;
  let pollTimer = null;
  let previewUrl = '';
  const originalDurationDisabled = Array.from(durationInput?.options || []).map((option) => option.disabled);

  function setError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
    loadingState.classList.add('hidden');
    statusText.textContent = 'Error';
    generateBtn.disabled = false;
    cancelBtn.disabled = true;
  }

  function setLoading(title, detail) {
    emptyState.classList.add('hidden');
    loadingState.classList.remove('hidden');
    loadingTitle.textContent = title;
    loadingDetail.textContent = detail;
    statusText.textContent = 'Procesando fotografía';
  }

  function setImageMode(enabled) {
    if (durationInput) {
      Array.from(durationInput.options).forEach((option, index) => {
        option.disabled = enabled ? Number(option.value) !== 5 : originalDurationDisabled[index];
      });
      if (enabled) durationInput.value = '5';
    }
    if (generateBtn) generateBtn.textContent = enabled ? 'Generar vídeo desde fotografía' : 'Generar vídeo';
  }

  imageInput.addEventListener('change', () => {
    selectedFile = imageInput.files?.[0] || null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    imagePreview.innerHTML = '';
    imagePreview.classList.add('hidden');
    if (!selectedFile) { setImageMode(false); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
      imageInput.value = ''; selectedFile = null; setImageMode(false); setError('Selecciona una fotografía JPG, PNG o WEBP.'); return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      imageInput.value = ''; selectedFile = null; setImageMode(false); setError('La fotografía no puede superar 20 MB.'); return;
    }
    previewUrl = URL.createObjectURL(selectedFile);
    imagePreview.innerHTML = `<img src="${previewUrl}" alt="Vista previa de la fotografía" /><span>Fotografía seleccionada · se animará durante 5 segundos</span>`;
    imagePreview.classList.remove('hidden');
    setImageMode(true);
  });

  audioPreviewBtn?.addEventListener('click', () => {
    const text = String(audioTextInput?.value || '').trim();
    if (!text) return setError('Escribe primero el texto de la narración.');
    if (!('speechSynthesis' in window)) return setError('La vista previa de voz no está disponible en este navegador.');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = audioLanguageInput?.value || 'en';
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  });

  async function checkBalance(cost) {
    const response = await fetch('/api/billing/balance', { headers: { 'X-Sala-User-Id': window.salaAccountId || '' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el saldo.');
    if (Number(data.credits || 0) < cost) throw new Error(`Créditos insuficientes. Esta generación necesita ${cost} crédito y tienes ${Number(data.credits || 0)}.`);
  }

  async function uploadPhoto() {
    const response = await fetch('/api/media/image', { method: 'POST', headers: { 'Content-Type': selectedFile.type }, body: selectedFile });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo subir la fotografía.');
    return data.url;
  }

  function saveHistory(url) {
    try {
      const key = 'salaHistory';
      const items = JSON.parse(localStorage.getItem(key) || '[]');
      items.unshift({ name: projectNameInput.value.trim() || 'Vídeo desde fotografía', prompt: promptInput.value.trim(), audioText: audioTextInput?.value.trim() || '', audioLanguage: audioLanguageInput?.value || 'en', aspect: document.querySelector('#aspect')?.value || '16:9', duration: 5, date: Date.now(), status: 'completado', url });
      localStorage.setItem(key, JSON.stringify(items.slice(0, 20)));
    } catch {}
  }

  async function pollImageJob(jobId) {
    imageJobId = jobId;
    clearTimeout(pollTimer);
    try {
      const response = await fetch(`/api/video/image-to-video/${encodeURIComponent(jobId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar la generación.');
      if (data.status === 'COMPLETED' && data.outputUrl) {
        videoPlayer.src = data.outputUrl;
        videoPlayer.classList.remove('hidden');
        videoLink.href = data.outputUrl;
        videoLink.classList.remove('hidden');
        loadingState.classList.add('hidden');
        statusText.textContent = 'Completado';
        saveHistory(data.outputUrl);
        generateBtn.disabled = false;
        cancelBtn.disabled = true;
        imageJobId = null;
        return;
      }
      if (data.status === 'ERROR') throw new Error(data.detail || 'No se pudo generar el vídeo desde la fotografía.');
      if (data.status === 'CANCELLED') {
        loadingState.classList.add('hidden'); statusText.textContent = 'Cancelado'; generateBtn.disabled = false; cancelBtn.disabled = true; imageJobId = null; return;
      }
      setLoading(audioTextInput?.value.trim() ? 'Generando vídeo + narración…' : 'Animando fotografía con Wan2.1 I2V Fast…', `${data.providerState || 'procesando'}. ${data.detail || 'La cola puede tardar unos minutos.'}`);
      pollTimer = setTimeout(() => pollImageJob(jobId), 5000);
    } catch (error) { setError(error.message || 'No se pudo completar la generación.'); imageJobId = null; }
  }

  form.addEventListener('submit', async (event) => {
    if (!selectedFile) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearTimeout(pollTimer);
    errorBox.classList.add('hidden');
    generateBtn.disabled = true;
    cancelBtn.disabled = false;
    try {
      await checkBalance(resolutionInput.value === 'high' ? 2 : 1);
      setLoading('Preparando fotografía…', 'Subiendo la imagen de referencia de forma segura.');
      const imageUrl = await uploadPhoto();
      const audioText = String(audioTextInput?.value || '').trim();
      const audioLanguage = audioLanguageInput?.value || 'en';
      setLoading(audioText ? 'Preparando vídeo y narración…' : 'Enviando a Wan2.1 I2V Fast…', audioText ? `La fotografía se animará y la voz se generará en ${audioLanguage}.` : 'Motor IA gratuito: movimiento humano real desde la fotografía.');
      const response = await fetch('/api/video/image-to-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: JSON.stringify({ motion: promptInput.value.trim(), audioText, audioLanguage }),
          imageUrl,
          aspect: document.querySelector('#aspect')?.value || '16:9',
          resolution: resolutionInput.value,
          audioText,
          audioLanguage
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar el vídeo desde la fotografía.');
      await pollImageJob(data.job_id);
    } catch (error) { setError(error.message || 'No se pudo generar el vídeo desde la fotografía.'); }
  }, true);

  cancelBtn.addEventListener('click', async (event) => {
    if (!imageJobId) return;
    event.preventDefault(); event.stopImmediatePropagation(); clearTimeout(pollTimer);
    try { await fetch(`/api/video/image-to-video/${encodeURIComponent(imageJobId)}/cancel`, { method: 'POST' }); }
    finally { imageJobId = null; loadingState.classList.add('hidden'); statusText.textContent = 'Cancelado'; generateBtn.disabled = false; cancelBtn.disabled = true; }
  }, true);
})();
