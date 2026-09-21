(() => {
  const $ = id => document.getElementById(id);
  const button = $('generateBtn');
  if (!button) return;

  const SPACE = 'DeepRat/LTX-Video-ZeroGPU-Optimized';
  let clientPromise = null;
  const HF_TOKEN_KEY = 'sala_hf_token';

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import('https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/dist/index.min.js')
        .then(({Client}) => {
          const token = localStorage.getItem(HF_TOKEN_KEY) || '';
          const options = {
            events: ['data', 'status'],
            status_callback: (s) => {
              const msg = s?.message || s?.detail || s?.stage || '';
              if ($('loadingDetail') && msg) $('loadingDetail').textContent = 'ZeroGPU: ' + msg;
            }
          };
          if (token) options.token = token;
          return Client.connect(SPACE, options);
        });
    }
    return clientPromise;
  }

  async function findEndpoint(client) {
    // The optimized LTX Space exposes this named API endpoint.
    // Use it directly instead of guessing from View API output.
    return '/text_to_video';
  }

  function videoUrl(v) {
    if (!v) return '';
    if (typeof v === 'string') {
      if (v.startsWith('http')) return v;
      return 'https://huggingface.co/spaces/' + SPACE + '/gradio_api/file=' + v.replace(/^\//, '');
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const found = videoUrl(item);
        if (found) return found;
      }
      return '';
    }
    if (typeof v === 'object') {
      if (typeof v.url === 'string' && v.url) return v.url;
      if (typeof v.path === 'string' && v.path) {
        if (v.path.startsWith('http')) return v.path;
        return 'https://huggingface.co/spaces/' + SPACE + '/gradio_api/file=' + v.path.replace(/^\//, '');
      }
      for (const key of ['video','output','value','file','data']) {
        if (v[key]) {
          const found = videoUrl(v[key]);
          if (found) return found;
        }
      }
    }
    return '';
  }

  async function generate(event) {
    event?.preventDefault();
    if (button.disabled) return;
    let prompt = ($('prompt')?.value || '').trim();
    const errorBox = $('errorBox');
    const showError = m => { if(errorBox){errorBox.textContent=m;errorBox.classList.remove('hidden');} };
    const dialogue = ($('audioText')?.value || '').trim();
    const lang = $('audioLanguage')?.selectedOptions?.[0]?.textContent || 'English';
    if (dialogue) prompt += `\n\nA visible character speaks on camera in ${lang}. Exact dialogue: "${dialogue}". Show natural facial expressions and mouth movement while speaking.`;
    if (!prompt) return showError('Escribe una descripción de la escena.');
    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Generating with LTX Video…';
    $('emptyState')?.classList.add('hidden');
    $('loadingState')?.classList.remove('hidden');
    if ($('loadingTitle')) $('loadingTitle').textContent = 'LTX Video 0.9.8 en cola…';
    if ($('loadingDetail')) $('loadingDetail').textContent = 'Generación gratuita mediante el Space oficial de Lightricks.';
    if ($('statusText')) $('statusText').textContent = 'Procesando';

    try {
      const client = await getClient();
      const endpoint = await findEndpoint(client);
      const duration = Math.max(0.3, Math.min(8.5, Number($('duration')?.value) || 2));
      const aspect = $('aspect')?.value || '16:9';
      const dims = {
        '16:9':[512,768],
        '9:16':[768,512],
        '1:1':[512,512]
      }[aspect] || [512,768];
      const negative = ($('negative')?.value || 'worst quality, inconsistent motion, blurry, jittery, distorted').trim();
      const seed = Math.floor(Math.random()*4294967295);
      const first = $('h3FirstFrame')?.files?.[0] || null;
      const {handle_file} = await import('https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/dist/index.min.js');
      const image = first ? handle_file(first) : null;
      const frames = Math.max(9, Math.min(257, Math.round(duration*30/8)*8+1));

      const result = await client.predict(endpoint, [
        prompt,
        negative,
        image,
        null,
        dims[0],
        dims[1],
        first ? 'image-to-video' : 'text-to-video',
        duration,
        frames,
        seed,
        true,
        3.0,
        true,
        false
      ]);

      const data = result?.data ?? result ?? [];
      const url = videoUrl(data);
      if (!url) {
        const shape = Array.isArray(data) ? data.map(x => typeof x).join(',') : typeof data;
        throw new Error('LTX terminó sin devolver un vídeo. Respuesta recibida: ' + shape);
      }
      const player = $('videoPlayer');
      if (player) { player.src=url; player.classList.remove('hidden'); player.load(); }
      const link=$('videoLink');
      if(link){link.href=url;link.classList.remove('hidden');}
      $('loadingState')?.classList.add('hidden');
      if($('statusText')) $('statusText').textContent='Completado';
    } catch (e) {
      $('loadingState')?.classList.add('hidden');
      if($('statusText')) $('statusText').textContent='Error';
      const raw = e?.message || String(e);
      const details = e?.cause?.message ? ` | ${e.cause.message}` : '';
      if (/ZeroGPU quota|quota exceeded|requested vs\./i.test(raw)) {
        showError('LTX ZeroGPU: Hugging Face no pudo reservar la GPU o la cuota disponible es insuficiente. Comprueba el token gratuito en Ajustes y vuelve a intentarlo más tarde.');
      } else {
        showError('Error de generación LTX Video: ' + raw + details);
      }
    } finally {
      button.disabled=false;
      button.textContent=old;
    }
  }

  window.startLtxGeneration = generate;
  window.startSalaGeneration = generate;
  const hfInput = $('hfTokenInput');
  const hfSave = $('saveHfTokenBtn');
  const hfStatus = $('hfTokenStatus');
  if (hfInput) hfInput.value = localStorage.getItem(HF_TOKEN_KEY) || '';
  hfSave?.addEventListener('click', () => {
    const token = (hfInput?.value || '').trim();
    if (token) localStorage.setItem(HF_TOKEN_KEY, token);
    else localStorage.removeItem(HF_TOKEN_KEY);
    clientPromise = null;
    if (hfStatus) hfStatus.textContent = token ? 'Token guardado en este navegador.' : 'Token eliminado.';
    setTimeout(() => { if (hfStatus) hfStatus.textContent = ''; }, 3000);
  });

  window.ltxBootReady = true;

  // Independent click path: LTX must remain callable even if the main app script
  // fails to initialize. The button is disabled immediately, so a second handler
  // cannot start a duplicate generation.
  button.addEventListener('click', (event) => {
    if (($('videoProvider')?.value || 'ltx') !== 'ltx') return;
    if (button.disabled) return;
    generate(event);
  });
})();
