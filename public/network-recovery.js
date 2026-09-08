(() => {
  const originalFetch = window.fetch.bind(window);
  const RETRIES = 4;
  const RETRY_DELAY_MS = 2500;
  const retryable = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return url.includes('/api/video/status/') || url.includes('/api/video/sequence/') || url.includes('/api/health');
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.fetch = async (input, init = {}) => {
    if (!retryable(input)) return originalFetch(input, init);

    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        const response = await originalFetch(input, { ...init, cache: 'no-store' });
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= RETRIES) break;
        if (typeof window.setLoading === 'function') {
          try { window.setLoading('Reconectando con el servidor…', `Conexión temporalmente interrumpida. Reintentando (${attempt + 1}/${RETRIES})…`); } catch {}
        }
        await wait(RETRY_DELAY_MS);
      }
    }

    throw new Error('Se perdió temporalmente la conexión con Sala de Proyección. El servidor no respondió después de varios intentos.');
  };
})();
