(() => {
  const init = () => {
    const panelTitle = document.querySelector('.audio-panel .panel-title h3');
    const textLabel = document.querySelector('label[for="audioText"]');
    const textInput = document.querySelector('#audioText');
    const languageLabel = document.querySelector('label[for="audioLanguage"]');
    const language = document.querySelector('#audioLanguage');
    if (!textInput || !language) return;

    if (panelTitle) panelTitle.textContent = '🔊 Dialogue / character voice';
    if (textLabel) textLabel.textContent = 'Dialogue or spoken text';
    textInput.placeholder = 'Example: Hello! Look at that fish!';

    if (!document.querySelector('#audioMode')) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<label for="audioMode">Audio type</label><select id="audioMode"><option value="dialogue" selected>Character dialogue (on-camera)</option><option value="narration">Narration / voice-over</option></select>';
      const field = wrapper.firstElementChild;
      const select = wrapper.lastElementChild;
      const row = languageLabel?.parentElement?.parentElement;
      if (row && field && select) {
        const modeBox = document.createElement('div');
        modeBox.append(field, select);
        row.insertBefore(modeBox, languageLabel.parentElement);
      }
    }

    const hint = document.querySelector('.audio-panel .hint');
    if (hint) hint.textContent = 'Dialogue mode asks WAN 2.2 to keep the speaker visible and speaking on camera. Audio is generated natively with the video; no separate TTS track is added after generation.';

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if ((url.includes('/api/video/generate') || url.includes('/api/video/sequence')) && init.body && typeof init.body === 'string') {
        try {
          const payload = JSON.parse(init.body);
          const mode = document.querySelector('#audioMode')?.value || 'dialogue';
          payload.audioMode = payload.audioText ? mode : 'dialogue';
          init = { ...init, body: JSON.stringify(payload) };
        } catch (_) {}
      }
      return originalFetch(input, init);
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
