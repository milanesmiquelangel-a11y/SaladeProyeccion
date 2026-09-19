(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#videoForm');
  if (!form) return;
  let activeRequest = null;
  const existingAudio = $('#audioText');
  if (!existingAudio) {
    const panel = document.createElement('section');
    panel.className = 'audio-panel';
    panel.id = 'klingNativeAudioPanel';
    panel.innerHTML = `
      <div class="panel-title"><h3>🔊 Native dialogue</h3><span>Optional · Kling VIDEO 3.0</span></div>
      <label for="klingAudioText">Dialogue spoken by the visible character</label>
      <textarea id="klingAudioText" maxlength="4000" placeholder="Example: Hello, welcome to our story."></textarea>
      <div class="fields">
        <div><label for="klingAudioLanguage">Voice language</label>
          <select id="klingAudioLanguage">
            <option value="en" selected>English</option><option value="es">Español</option><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="pt">Português</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="zh-CN">中文</option><option value="tr">Türkçe</option><option value="ar">العربية</option><option value="hi">हिन्दी</option>
          </select>
        </div>
        <div><label>Audio mode</label><div class="hint">Native audio + visible lip movement</div></div>
      </div>
      <p class="hint">The spoken character must be visible. Kling generates the dialogue, audio and mouth movement in the same video generation. No post-generated TTS track is added.</p>`;
    form.querySelector('.phase-note')?.after(panel) || form.prepend(panel);
  }

  function setBusy(title, detail) {
    const loading = $('#loadingState'), empty = $('#emptyState');
    if (empty) empty.classList.add('hidden');
    if (loading) loading.classList.remove('hidden');
    if ($('#loadingTitle')) $('#loadingTitle').textContent = title;
    if ($('#loadingDetail')) $('#loadingDetail').textContent = detail;
    if ($('#statusText')) $('#statusText').textContent = 'Procesando';
  }
  function fail(message) {
    const box = $('#errorBox');
    if (box) { box.textContent = message; box.classList.remove('hidden'); }
    if ($('#loadingState')) $('#loadingState').classList.add('hidden');
    if ($('#generateBtn')) $('#generateBtn').disabled = false;
    if ($('#cancelBtn')) $('#cancelBtn').disabled = true;
  }
  function done(url) {
    const video = $('#videoPlayer');
    if (video) { video.src = url; video.classList.remove('hidden'); video.load(); }
    const link = $('#videoLink');
    if (link) { link.href = url; link.classList.remove('hidden'); }
    if ($('#loadingState')) $('#loadingState').classList.add('hidden');
    if ($('#statusText')) $('#statusText').textContent = 'Completado';
    if ($('#generateBtn')) $('#generateBtn').disabled = false;
    if ($('#cancelBtn')) $('#cancelBtn').disabled = true;
    activeRequest = null;
  }
  async function poll(id) {
    const response = await fetch(`/api/video/status/${encodeURIComponent(id)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el estado.');
    if (data.status === 'COMPLETED' && data.outputUrl) return done(data.outputUrl);
    if (data.status === 'ERROR' || data.status === 'CANCELLED') throw new Error(data.detail || 'La generación terminó con error.');
    setBusy(data.nativeAudio ? 'Generating video + native dialogue…' : 'Generating video…', data.detail || 'Kling VIDEO 3.0 is processing the scene.');
    setTimeout(() => poll(id).catch(fail), 5000);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const prompt = String($('#prompt')?.value || '').trim();
    if (!prompt) return fail('Describe the scene first.');
    const duration = Number($('#duration')?.value || 5);
    if (duration < 3 || duration > 15) return fail('Kling VIDEO 3.0 supports one 3–15 second take for this native-dialogue path.');
    const dialogue = String($('#klingAudioText')?.value || '').trim();
    const language = String($('#klingAudioLanguage')?.value || 'en');
    const negative = String($('#negative')?.value || '').trim();
    const aspect = $('#aspect')?.value || '16:9';
    const resolution = $('#resolution')?.value || 'standard';
    const frameRate = Number($('#frameRate')?.value || 24);
    try {
      $('#errorBox')?.classList.add('hidden');
      if ($('#generateBtn')) $('#generateBtn').disabled = true;
      if ($('#cancelBtn')) $('#cancelBtn').disabled = false;
      setBusy(dialogue ? 'Generating video + native dialogue…' : 'Generating video…', dialogue ? 'Kling is generating speech, audio and visible mouth movement together.' : 'Kling VIDEO 3.0 is generating the scene.');
      const response = await fetch('/api/video/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt,negative,aspect,duration,resolution,frameRate,audioText:dialogue,audioLanguage:language}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not start the generation.');
      activeRequest = data.request_id;
      await poll(activeRequest);
    } catch (e) { fail(e.message || 'Generation failed.'); }
  }, true);

  $('#cancelBtn')?.addEventListener('click', async (event) => {
    if (!activeRequest) return;
    event.stopImmediatePropagation();
    try { await fetch(`/api/video/cancel/${encodeURIComponent(activeRequest)}`, { method:'POST' }); } catch {}
    fail('Generation cancelled.');
  }, true);
})();
