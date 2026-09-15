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

  // PayPal may return billing=cancel together with a valid subscription_id.
  // The subscription ID is authoritative, so verify it server-side instead of
  // discarding it. This also recovers subscriptions created before the newer
  // billing-ui sessionStorage flow was deployed.
  const syncPayPalReturn = async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') !== 'cancel') return;
    const subscriptionId = String(params.get('subscription_id') || '').trim();
    if (!/^I-[A-Z0-9]+$/i.test(subscriptionId)) return;

    try {
      const response = await originalFetch('/api/billing/sync-subscription', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ subscriptionId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo sincronizar la suscripción de PayPal.');

      const balanceResponse = await originalFetch('/api/billing/balance', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const balance = await balanceResponse.json().catch(() => ({}));
      if (balanceResponse.ok) {
        const current = (() => {
          try { return JSON.parse(localStorage.getItem('salaBilling') || '{}'); } catch { return {}; }
        })();
        localStorage.setItem('salaBilling', JSON.stringify({
          ...current,
          credits: Number(balance.credits || 0),
          plan: balance.plan || 'Gratis',
          totalConsumed: Number(balance.totalConsumed || 0),
          nextRechargeAt: balance.nextRechargeAt || null,
          freeRechargeCredits: Number(balance.freeRechargeCredits || 3)
        }));
        window.dispatchEvent(new Event('sala-billing-updated'));
      }

      // Keep the result visible for the user while preventing another automatic
      // sync if the page is refreshed. The server-side event ID remains idempotent.
      const message = data.credited
        ? `Suscripción confirmada. Se añadieron ${data.credits ?? ''} créditos de tu plan.`
        : data.pending
          ? 'La suscripción de PayPal sigue pendiente de activación.'
          : 'Suscripción de PayPal sincronizada.';
      try { sessionStorage.setItem('salaPayPalReturnMessage', message); } catch {}
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      console.error('PayPal return sync error:', error);
    }
  };

  syncPayPalReturn();
})();
