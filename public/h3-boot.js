(() => {
  const $ = (id) => document.getElementById(id);
  const button = $('generateBtn');
  if (!button) return;
  window.salaBootReady = true;

  async function generateDirect(event) {
    if (button.disabled) return;
    if (event) event.preventDefault();
    const prompt = ($('prompt')?.value || '').trim();
    const errorBox = $('errorBox');
    const showError = (message) => {
      if (errorBox) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
    };
    if (!prompt) return showError('Escribe una descripción de la escena.');
    const provider = $('videoProvider')?.value || 'h3';
    if (provider !== 'h3') return showError('La conexión directa está preparada ahora para MiniMax H3. Selecciona MiniMax H3 Turbo.');
    const loading = $('loadingState');
    const empty = $('emptyState');
    const title = $('loadingTitle');
    const detail = $('loadingDetail');
    const status = $('statusText');
    const setLoading = (t,d) => {
      empty?.classList.add('hidden'); loading?.classList.remove('hidden');
      if (title) title.textContent=t; if(detail) detail.textContent=d;
      if(status) status.textContent='Procesando';
    };
    const showVideo = (url) => {
      loading?.classList.add('hidden'); empty?.classList.add('hidden');
      const video=$('videoPlayer'), link=$('videoLink');
      if(video){ video.src=url; video.classList.remove('hidden'); video.load(); }
      if(link){ link.href=url; link.classList.remove('hidden'); }
      if(status) status.textContent='Completado';
    };
    const oldText=button.textContent;
    button.disabled=true;
    setLoading('Conectando con MiniMax H3…','Cargando el cliente oficial de Hugging Face.');
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/dist/index.min.js');
      const Client = mod.Client, handle_file = mod.handle_file;
      if(!Client) throw new Error('No se pudo cargar @gradio/client.');
      setLoading('Conectando con MiniMax H3…','Preparando la GPU gratuita de ZeroGPU.');
      // Use the official current Gradio client. Data events are sufficient here and avoid
      // parsing legacy status payloads that some ZeroGPU workflow responses may omit.
      const client = await Client.connect('MiniMaxAI/MiniMax-H3-Turbo-Lora');
      const languageNames={en:'English',es:'Spanish',ru:'Russian',kk:'Kazakh',fr:'French',de:'German',it:'Italian',pt:'Portuguese',ar:'Arabic',ja:'Japanese',ko:'Korean','zh-CN':'Chinese'};
      const dialogue=($('audioText')?.value || '').trim();
      const lang=languageNames[$('audioLanguage')?.value || 'en'] || 'English';
      const fullPrompt = dialogue
        ? prompt+'\n\nThe visible character is the source of the voice. The character speaks physically with natural facial expressions, jaw and lip movements synchronized to every spoken word. No off-screen narrator. The character says exactly: <d>['+lang+'] '+dialogue+'</d>. The mouth must move while the dialogue is heard. Generate the dialogue as part of the synchronized soundtrack.'
        : prompt;
      const aspect=$('aspect')?.value || '16:9';
      const canvas={'16:9':'1344x768 · 16:9 full','9:16':'768x1344 · 9:16 full','1:1':'768x768 · 1:1 full'}[aspect] || '1344x768 · 16:9 full';
      const duration=Math.max(2,Math.min(14,Number($('duration')?.value)||5));
      const first=$('h3FirstFrame')?.files?.[0];
      const last=$('h3LastFrame')?.files?.[0];
      const payload={
        prompt: fullPrompt,
        image: first ? handle_file(first) : null,
        last_image: last ? handle_file(last) : null,
        canvas,
        duration,
        steps: 6,
        seed: Math.floor(Math.random()*2147483647),
        upsample: false,
        lora: 'larry'
      };
      setLoading('MiniMax H3 en cola…','Esperando GPU gratuita de ZeroGPU.');
      const job=client.submit('/predict_fn_generate_video', [payload.prompt, payload.image, payload.last_image, payload.canvas, payload.duration, payload.steps, payload.seed, payload.upsample, payload.lora]);
      const startedAt=Date.now();
      const queueWatch=setInterval(() => {
        const elapsed=Math.floor((Date.now()-startedAt)/1000);
        if (elapsed < 60) setLoading('MiniMax H3 en cola…',`Esperando GPU gratuita de ZeroGPU · ${elapsed} s.`);
        else setLoading('MiniMax H3 en cola…',`La GPU todavía no está disponible · ${Math.floor(elapsed/60)} min ${elapsed%60} s.`);
      },15000);
      const timeout=setTimeout(() => { try { job.cancel(); } catch (_) {} },300000);
      try {
        for await (const msg of job) {
          if(msg.type==='data'){
            const data=msg.data || [];
            const video=data[0];
            const url=typeof video==='string' ? video : (video?.url || (video?.path ? 'https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora/gradio_api/file='+video.path : ''));
            if(!url) throw new Error('MiniMax H3 terminó pero no devolvió el vídeo.');
            showVideo(url);
            break;
          }
        }
      } finally {
        clearInterval(queueWatch); clearTimeout(timeout);
      }
      if (!document.getElementById('videoPlayer')?.src) throw new Error('MiniMax H3 no obtuvo GPU después de 5 minutos. La cola de ZeroGPU está saturada. Inténtalo de nuevo más tarde.');
    } catch(error) {
      showError('Error de generación: '+(error?.message || String(error)));
      if(status) status.textContent='Error';
      loading?.classList.add('hidden');
    } finally {
      button.disabled=false;
      button.textContent=oldText;
    }
  }

  window.startSalaGeneration = generateDirect;
  button.addEventListener('click', generateDirect);
})();