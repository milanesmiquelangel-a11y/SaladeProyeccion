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
    if (provider !== 'h3') return showError('Selecciona MiniMax H3 Turbo para usar la generación gratuita.');

    const loading = $('loadingState'), empty = $('emptyState'), title = $('loadingTitle');
    const detail = $('loadingDetail'), status = $('statusText');
    const setLoading = (t,d) => {
      empty?.classList.add('hidden'); loading?.classList.remove('hidden');
      if (title) title.textContent=t;
      if (detail) detail.textContent=d;
      if (status) status.textContent='Procesando';
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
    setLoading('Conectando con MiniMax H3…','Consultando la API disponible del Space oficial.');
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/dist/index.min.js');
      const Client = mod.Client, handle_file = mod.handle_file;
      if(!Client) throw new Error('No se pudo cargar @gradio/client.');
      const client = await Client.connect('MiniMaxAI/MiniMax-H3-Turbo-Lora');
      // The live Space has already exposed this exact Workflow endpoint:
      // /predict_fn_generate_video. Do not depend on view_api(), because
      // ZeroGPU can expose the endpoint metadata inconsistently to clients.
      const endpoint = '/output_video';

      const languageNames={en:'English',es:'Spanish',ru:'Russian',kk:'Kazakh',fr:'French',de:'German',it:'Italian',pt:'Portuguese',ar:'Arabic',ja:'Japanese',ko:'Korean','zh-CN':'Chinese'};
      const dialogue=($('audioText')?.value || '').trim();
      const lang=languageNames[$('audioLanguage')?.value || 'en'] || 'English';
      const fullPrompt = dialogue
        ? prompt+'\n\nThe visible character is the source of the voice. The character speaks physically with natural facial expressions, jaw and lip movements synchronized to every spoken word. No off-screen narrator. The character says exactly: <d>['+lang+'] '+dialogue+'</d>. The mouth must move while the dialogue is heard. Generate the dialogue as part of the synchronized soundtrack.'
        : prompt;
      const aspect=$('aspect')?.value || '16:9';
      const canvas={'16:9':'1344x768 · 16:9 full','9:16':'768x1344 · 9:16 full','1:1':'768x768 · 1:1 full'}[aspect] || '1344x768 · 16:9 full';
      const duration=Math.max(5,Math.min(15,Number($('duration')?.value)||5));
      const first=$('h3FirstFrame')?.files?.[0];
      const last=$('h3LastFrame')?.files?.[0];
      const firstRef=first ? handle_file(first) : null;
      const lastRef=last ? handle_file(last) : null;
      const seed=Math.floor(Math.random()*2147483647);

      setLoading('MiniMax H3 en cola…','Solicitud enviada. Esperando GPU gratuita de ZeroGPU…');
      let result;
      try {
        // Current live H3 Workflow endpoint.
        result = await client.predict(endpoint, [fullPrompt, firstRef, lastRef, canvas, duration, 4, seed, false, 'larry']);
      } catch (workflowError) {
        throw new Error('MiniMax H3 rechazó el endpoint /output_video: ' + (workflowError?.message || String(workflowError)));
      }

      let data=result?.data || result || [];
      if(data.length===1 && Array.isArray(data[0])) data=data[0];
      const video=data[0];
      const url=typeof video==='string'
        ? video
        : (video?.url || (video?.path ? 'https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora/gradio_api/file='+video.path : ''));
      if(!url) throw new Error('MiniMax H3 terminó pero no devolvió el vídeo.');
      showVideo(url);
    } catch(error) {
      showError('Error de generación: '+(error?.message || String(error)));
      if(status) status.textContent='Error';
      loading?.classList.add('hidden');
    } finally {
      button.disabled=false;
      button.textContent=oldText;
    }
  }

  window.startH3Generation = generateDirect;
  window.startSalaGeneration = generateDirect;
  button.addEventListener('click', generateDirect);
})();