(() => {
  const nativeFetch = window.fetch.bind(window);
  const form = document.querySelector('#videoForm');
  const durationInput = document.querySelector('#duration');
  const resolutionInput = document.querySelector('#resolution');
  const generateBtn = document.querySelector('#generateBtn');
  if (!form || !durationInput || !resolutionInput || !generateBtn) return;

  const costFor = (body = {}, route = '') => {
    const multiplier = body.resolution === 'high' ? 2 : 1;
    if (route.includes('/api/video/sequence')) return Math.max(1, Math.ceil(Number(body.duration) / 5 || 1)) * multiplier;
    return multiplier;
  };

  const message = document.createElement('div');
  message.id = 'generationCostInfo';
  message.className = 'billing-notice';
  message.setAttribute('role', 'status');
  generateBtn.parentNode.insertBefore(message, generateBtn);

  function formatCountdown(next) {
    if (!next) return 'No hay fecha de recarga disponible.';
    const remaining = Math.max(0, Number(next) - Date.now());
    if (!remaining) return 'La recarga gratuita está disponible. Actualiza el saldo.';
    const total = Math.floor(remaining / 1000);
    return `Próxima recarga: ${new Date(next).toLocaleString('es-ES')} · faltan ${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min ${total % 60} s.`;
  }

  async function diagnoseBalanceError(fallbackError) {
    try {
      const healthResponse = await nativeFetch('/api/health');
      const health = await healthResponse.json().catch(() => ({}));
      const detail = health.billingDatabaseError || health.databaseError || health.billingDatabase || fallbackError?.message;
      return detail || `Error del servidor (${healthResponse.status}).`;
    } catch {
      return fallbackError?.message || 'El servidor no respondió correctamente.';
    }
  }

  async function refreshInfo() {
    try {
      const response = await nativeFetch('/api/billing/balance', { headers: { 'X-Sala-User-Id': window.salaAccountId || '' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status}).`);
      const cost = costFor({ duration: Number(durationInput.value), resolution: resolutionInput.value }, Number(durationInput.value) > 5 ? '/api/video/sequence' : '/api/video/generate');
      message.innerHTML = `<strong>Saldo: ${Number(data.credits || 0)} créditos</strong> · Esta generación: <strong>${cost} crédito${cost === 1 ? '' : 's'}</strong><br><span>${Number(data.credits || 0) >= cost ? '✅ Puedes generar.' : `❌ Créditos insuficientes. ${formatCountdown(data.nextRechargeAt)}`}</span>`;
    } catch (error) {
      const detail = await diagnoseBalanceError(error);
      message.textContent = `⚠️ Saldo no disponible: ${detail}`;
    }
  }

  [durationInput, resolutionInput].forEach((input) => input.addEventListener('change', refreshInfo));
  refreshInfo();
  setInterval(refreshInfo, 1000);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/video/generate') && !url.includes('/api/video/sequence')) return nativeFetch(input, init);
    let body = {};
    try { body = JSON.parse(init.body || '{}'); } catch {}
    const cost = costFor(body, url);
    try {
      const response = await nativeFetch('/api/billing/balance', { headers: { 'X-Sala-User-Id': window.salaAccountId || '' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return new Response(JSON.stringify({ error: data.error || `No se pudo consultar el saldo (HTTP ${response.status}).` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      if (Number(data.credits || 0) < cost) {
        const text = `Créditos insuficientes. Esta generación necesita ${cost} crédito${cost === 1 ? '' : 's'} y tienes ${Number(data.credits || 0)}. ${formatCountdown(data.nextRechargeAt)}`;
        message.innerHTML = `<strong>❌ No se puede generar</strong><br>${text}`;
        return new Response(JSON.stringify({ error: text, credits: Number(data.credits || 0), required: cost, nextRechargeAt: data.nextRechargeAt || null }), { status: 402, headers: { 'Content-Type': 'application/json' } });
      }
    } catch {
      // Let the server remain the final authority if the preflight request fails.
    }
    return nativeFetch(input, init);
  };
})();
