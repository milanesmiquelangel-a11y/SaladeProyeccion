(() => {
  const originalFetch = window.fetch.bind(window);
  const RETRIES = 12;
  const RETRY_DELAY_MS = 2500;
  const isStatusPoll = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return url.includes('/api/video/status/') || url.includes('/api/video/sequence/');
  };
  const isHealth = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return url.includes('/api/health');
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.fetch = async (input, init = {}) => {
    const statusPoll = isStatusPoll(input);
    const healthPoll = isHealth(input);
    if (!statusPoll && !healthPoll) return originalFetch(input, init);

    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        const response = await originalFetch(input, { ...init, cache: 'no-store' });
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= RETRIES) break;
        if (typeof window.setLoading === 'function' && statusPoll) {
          try {
            window.setLoading(
              'Reconectando con el servidor…',
              `Conexión temporalmente interrumpida. Reintentando (${attempt + 1}/${RETRIES})…`
            );
          } catch {}
        }
        await wait(RETRY_DELAY_MS);
      }
    }

    // A lost browser connection must NOT turn an active Pixazo generation into a
    // terminal client error. Return a temporary PROCESSING response so app.js keeps
    // polling until the server reports COMPLETED, FAILED, CANCELLED or its timeout.
    if (statusPoll) {
      return new Response(JSON.stringify({
        status: 'PROCESSING',
        transientConnectionError: true,
        message: 'Conexión temporal perdida; la generación continúa en el servidor.'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    throw lastError || new Error('No se pudo conectar con Sala de Proyección.');
  };
})();
