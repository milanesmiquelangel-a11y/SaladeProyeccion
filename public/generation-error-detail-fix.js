(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (!url.includes('/api/video/status/')) return response;
      const clone = response.clone();
      const data = await clone.json();
      if (data && data.detail && !data.error && ['ERROR', 'FAILED', 'CANCELLED'].includes(String(data.status || '').toUpperCase())) {
        data.error = data.detail;
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (_) {}
    return response;
  };
})();
