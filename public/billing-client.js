(() => {
  const KEY = 'salaUserId';
  const BILLING_KEY = 'salaBilling';
  let id = localStorage.getItem(KEY);
  if (!id || !/^[a-zA-Z0-9_-]{16,80}$/.test(id)) {
    id = crypto.randomUUID().replaceAll('-', '');
    localStorage.setItem(KEY, id);
  }
  window.salaAccountId = id;

  const nativeFetch = window.fetch.bind(window);
  const readBilling = () => {
    try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '{}'); }
    catch { return {}; }
  };
  const saveBilling = (patch) => {
    localStorage.setItem(BILLING_KEY, JSON.stringify({ ...readBilling(), ...patch }));
    window.dispatchEvent(new Event('sala-billing-updated'));
  };
  const generationCost = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/video/generate') && !url.includes('/api/video/sequence')) return 0;
    let body = {};
    try { body = JSON.parse(init.body || '{}'); } catch {}
    const multiplier = body.resolution === 'high' ? 2 : 1;
    if (url.includes('/api/video/sequence')) return Math.max(1, Math.ceil(Number(body.duration) / 5 || 1)) * multiplier;
    return multiplier;
  };

  async function preflightGeneration(input, init, cost) {
    if (!cost) return null;
    try {
      const balanceResponse = await nativeFetch('/api/billing/balance', {
        headers: { 'X-Sala-User-Id': id }
      });
      const balance = await balanceResponse.json().catch(() => ({}));
      if (!balanceResponse.ok) return null;
      const credits = Number(balance.credits || 0);
      saveBilling({
        credits,
        plan: balance.plan || 'Gratis',
        totalConsumed: Number(balance.totalConsumed || 0),
        nextRechargeAt: balance.nextRechargeAt || null,
        freeRechargeCredits: Number(balance.freeRechargeCredits || 3)
      });
      if (credits >= cost) return null;

      const next = balance.nextRechargeAt ? new Date(balance.nextRechargeAt) : null;
      const rechargeText = next && !Number.isNaN(next.getTime())
        ? ` Próxima recarga gratuita: ${next.toLocaleString('es-ES')}.`
        : '';
      const message = `Créditos insuficientes. Esta generación necesita ${cost} crédito${cost === 1 ? '' : 's'} y tienes ${credits}.${rechargeText}`;
      return new Response(JSON.stringify({
        error: message,
        credits,
        required: cost,
        nextRechargeAt: balance.nextRechargeAt || null,
        preflight: true
      }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return null;
    }
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    if (!sameOrigin) return nativeFetch(input, init);

    const cost = generationCost(input, init);
    const preflightResponse = await preflightGeneration(input, init, cost);
    if (preflightResponse) return preflightResponse;

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Sala-User-Id', id);
    const response = await nativeFetch(input, { ...init, headers });
    const credits = response.headers.get('X-Sala-Credits');
    const responseCost = response.headers.get('X-Sala-Cost');
    if (credits !== null) {
      saveBilling({ credits: Number(credits), lastCost: Number(responseCost || 0) });
    } else if (response.status === 402) {
      const data = await response.clone().json().catch(() => ({}));
      if (data.nextRechargeAt) saveBilling({ nextRechargeAt: data.nextRechargeAt, credits: Number(data.credits || 0) });
    }
    return response;
  };

  async function refreshBalance() {
    try {
      const response = await nativeFetch('/api/billing/balance', { headers: { 'X-Sala-User-Id': id } });
      if (!response.ok) return;
      const data = await response.json();
      saveBilling({
        credits: Number(data.credits || 0),
        plan: data.plan || 'Gratis',
        totalConsumed: Number(data.totalConsumed || 0),
        nextRechargeAt: data.nextRechargeAt || null,
        freeRechargeCredits: Number(data.freeRechargeCredits || 3)
      });
    } catch {}
  }
  refreshBalance();
})();
